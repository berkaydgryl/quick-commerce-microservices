/**
 * Kilidi dusmus siparisin kapatilmasi: karar TEK yerde (T15.3; bekleyen is 122).
 * Iki yol ayni tabloyu uygular: supurucu (sweep-expired-reservations.ts, T11.2
 * PR 2) ve odeme ya da 3DS denemesinde kilidi dusmus bulan saga (lock-timing.ts).
 *
 *   DRAFT            -> odeme olamaz, kayda BAKILMAZ; CANCELLED, kilit birakilir
 *   AWAITING_PAYMENT -> once odeme kaydina bakilir (payment-standing.ts):
 *     para alinmis   -> once Commit (bekleyen is 124):
 *       kesinlesti   -> PAID (onceki deneme kesinlestirmis ya da sure gecmis
 *                       ama kilit henuz birakilmamis); iade YOK
 *       kilit yok    -> CANCELLED + iade KOMUTU ayni yazimda, kilit birakilir,
 *                       sonra dogrudan iade denenir (hizli yol)
 *     cekim suruyor  -> HICBIR SEY yazilmaz (sonucu payment verecek)
 *     para alinmamis -> CANCELLED, kilit birakilir (3DS bekleyen dahil)
 *   payment-svc ya da inventory'ye ulasilamazsa hata yukari gider, hicbir sey
 *   yazilmaz.
 *
 * Neden Commit: inventory, kesinlesmis kilidin uzatma ve kisaltmasina da
 * RESERVATION_EXPIRED doner. Commit ise kesinlesmis kilidi taniyip
 * ALREADY_APPLIED der; satilmis stokla siparis iptal edilip iade edilmez.
 *
 * Kilitsiz kapatma (CANCELLED, iade komutu ve isaret ayni yazimda) ayri
 * dosyadadir: stockless-close.ts; odeme adimi da onu kullanir.
 *
 * Sira: once siparis yazilir (surum kontrollu), sonra kilit ve iade. Siparisi o
 * arada baska bir yazim degistirdiyse (CONFLICT) dokunulmaz; tek istisna para:
 * alinmissa ve siparisi baska yol IPTAL ettiyse (kullanici iptali ya da odemeyi
 * henuz gormemis bir kapatma) iade yine yapilir - dogrudan, olmazsa outbox komutu
 * (refund-step.ts). Sabit anahtar ikinci iadeyi onler.
 */

import { ORDER_STATUS } from '@getir/core';

import { PAYMENT_STATUS, REFUND_REASON } from '../domain/checkout-payment.js';
import type { PaymentStatus } from '../domain/checkout-payment.js';
import type { Order } from '../domain/order.js';
import { PAYMENT_STANDING, paymentStandingOf } from '../domain/payment-standing.js';
import { paidOrder, tryWriteTransition } from './order-transition.js';
import type { Payments } from './payments.js';
import { refundIfCancelledElsewhere } from './refund-step.js';
import type { RequestScope } from './request-scope.js';
import { SETTLEMENT } from './stock-reservations.js';
import { CHARGE, closeWithoutStock } from './stockless-close.js';
import type { StocklessClose, StocklessCloseDeps } from './stockless-close.js';
import { commitStock } from './stock-step.js';

export interface LapseDeps extends StocklessCloseDeps {
  readonly payments: Pick<Payments, 'getPayment' | 'refund'>;
}

/**
 * Kapatmanin sonucu:
 *   closed    - CANCELLED yazildi, kilit birakildi (para alinmamisti);
 *   refunded  - CANCELLED ve iade komutu yazildi, kilit birakildi;
 *   paid      - para alinmis, stok kesinlesmis: siparis PAID (bekleyen is 124);
 *               recovered: PAID'i bu cagri yazdi (false: baska yol yazmisti);
 *   in-flight - kart cekimi suruyor, HICBIR SEY yazilmadi;
 *   conflict  - siparis o arada degisti, dokunulmadi.
 */
export type LapseOutcome =
  | StocklessClose
  | { readonly kind: 'paid'; readonly order: Order; readonly recovered: boolean }
  | { readonly kind: 'in-flight'; readonly paymentStatus: PaymentStatus };

/**
 * Kilidi dusmus siparisi tabloya gore kapatir.
 * @throws payment-svc ya da inventory'ye ulasilamazsa hatasi (hicbir sey yazilmaz).
 */
export async function closeLapsedOrder(
  deps: LapseDeps,
  order: Order,
  scope: RequestScope,
): Promise<LapseOutcome> {
  if (order.status === ORDER_STATUS.DRAFT) {
    return closeWithoutStock(deps, order, CHARGE.NONE, scope);
  }
  const payment = await deps.payments.getPayment(order.id, scope);
  const standing = paymentStandingOf(payment);
  if (payment !== null && standing === PAYMENT_STANDING.IN_FLIGHT) {
    return { kind: 'in-flight', paymentStatus: payment.status };
  }
  if (standing !== PAYMENT_STANDING.CHARGED) {
    // Para alinip baska yolda iade edilmisse (odeme cakismasinda dogrudan iade,
    // siparis o an acikti) kapatma isareti yazar: siparis gecmiste kalir (#166).
    const charge = payment?.status === PAYMENT_STATUS.REFUNDED ? CHARGE.REFUNDED : CHARGE.NONE;
    return closeWithoutStock(deps, order, charge, scope);
  }
  return completeOrRefund(deps, order, scope);
}

/**
 * Para alinmis: kilit "dusmus" gorunse de ilk deneme kesinlestirmis olabilir.
 * Commit yoklar: kesinlestiyse PAID, kilit yoksa iptal ve iade.
 */
async function completeOrRefund(
  deps: LapseDeps,
  order: Order,
  scope: RequestScope,
): Promise<LapseOutcome> {
  const settlement = await commitStock(deps, order, scope);
  if (settlement === SETTLEMENT.NOT_FOUND) {
    return closeWithoutStock(deps, order, CHARGE.TAKEN, scope);
  }
  const write = await tryWriteTransition(
    deps.repository,
    order,
    paidOrder(order, deps.clock, undefined),
  );
  if (write.written) {
    scope.logger.warn(
      { orderId: order.id, settlement },
      'kilidi dusmus gorunen siparisin stogu kesinlesmisti; odeme alinmis, siparis PAID',
    );
    return { kind: 'paid', order: write.order, recovered: true };
  }
  if (write.latest?.status === ORDER_STATUS.PAID) {
    // Ayni odemenin es zamanli tekrari PAID yazmis: sonuc ayni, sayilmaz.
    return { kind: 'paid', order: write.latest, recovered: false };
  }
  await refundIfCancelledElsewhere(
    deps,
    order,
    write.latest,
    REFUND_REASON.ORDER_CHANGED_DURING_PAYMENT,
    scope,
  );
  return { kind: 'conflict' };
}
