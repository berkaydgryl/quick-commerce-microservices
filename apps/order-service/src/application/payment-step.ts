/**
 * Saga'nin odeme adimi (T7.1): cekim ve sonucun siparise islenmesi.
 * CreateOrder (cekim) ve ConfirmPayment (3DS onayi) ayni isleme yolunu kullanir.
 *
 * TELAFI: cekim basarili oldu ama siparis PAID yazilamadi (surum cakismasi -
 * ornegin kullanici tam o anda iptal etti) -> para GERI VERILIR, istemci
 * CONFLICT alir. Cakismanin sebebi ayni odemenin es zamanli ikinci istegiyse
 * (siparis zaten PAID) iade YAPILMAZ: kazanan istek siparisi odenmis yazmistir.
 *
 * KILIT SURESI (T11.3): cekimden ONCE kalan sure kisaysa kilit uzatilir; kilit
 * dusmusse para CEKILMEZ, siparis lapsed-order.ts'in tablosuyla kapatilir
 * (CANCELLED + 410; onceki deneme cektiyse iade, cekip stogu kesinlestirdiyse
 * PAID ve cekim tekrarlanmaz).
 *
 * STOK (T11.2): odeme alininca kilit PAID'den ONCE kesinlesir (Commit) - "odendi
 * ama stok kesinlesmedi" durumu olusmaz. Commit gecici hata verirse siparis odeme
 * bekler kalir; ayni istek tekrar gelince cekim idempotent ilk sonucu doner,
 * Commit yeniden denenir. Kilit o arada dustuyse siparis CANCELLED ve para
 * alinmissa iade komutu AYNI yazimda (lapsed-order.ts), istemci
 * RESERVATION_EXPIRED alir. Kart reddinde kilit birakilir.
 */

import { AppError, ORDER_STATUS } from '@getir/core';
import type { ErrorCode } from '@getir/core';

import {
  chargeIdempotencyKey,
  decidePayment,
  PAYMENT_STATUS,
  REFUND_REASON,
} from '../domain/checkout-payment.js';
import type { PaymentMethod, PaymentResult } from '../domain/checkout-payment.js';
import { assertPaymentMethodAllowed, paymentPolicyOf } from '../domain/checkout-risk.js';
import type { OrderOutbox } from '../domain/order-outbox.js';
import { assertSamePayment, paymentChoiceOf } from '../domain/order-payment.js';
import type { DeliveryPaymentKind } from '../domain/order-payment.js';
import type { OrderRepository } from '../domain/order-repository.js';
import type { Order } from '../domain/order.js';
import { transitionOrder } from '../domain/order.js';
import { RELEASE_REASON } from '../domain/stock-reservation.js';
import { closeWithoutStock } from './lapsed-order.js';
import { securePaymentWindow, throwLapse } from './lock-timing.js';
import type { LockTimingDeps } from './lock-timing.js';
import { isConflict, writePaid, writeTransition } from './order-transition.js';
import type { Payments } from './payments.js';
import { refundCharge } from './refund-step.js';
import type { RequestScope } from './request-scope.js';
import { SETTLEMENT } from './stock-reservations.js';
import { commitStock, releaseStock } from './stock-step.js';

export interface PaymentStepDeps extends LockTimingDeps {
  readonly repository: Pick<OrderRepository, 'update' | 'findById'>;
  readonly payments: Payments;
  /** Telafi komutu (T7.3): dogrudan iade basarisizsa kalici olarak yazilir. */
  readonly outbox: Pick<OrderOutbox, 'append'>;
}

export interface CheckoutResult {
  readonly order: Order;
  /** Yalnizca 3DS bekleniyorsa dolu; istemci ConfirmPayment'a geri verir. */
  readonly challengeId?: string;
  /** 3DS kodunun gecerlilik bitisi (T12.4); payment-svc'nin penceresi. */
  readonly challengeExpiresAt?: Date;
}

/**
 * Kart kaynagi (T12.4): kasadaki kart (cardId) ya da eski test jetonu
 * (cardToken, DEPRECATED); kartli odemede TAM biri, kapida odemede hicbiri.
 * Kayitli kart yoksa payment-svc NOT_FOUND doner ve kayit yazmaz: siparis
 * AWAITING_PAYMENT kalir, ayni siparis baska kartla yeniden verilebilir.
 */
export interface PaymentChoice {
  readonly method: PaymentMethod;
  readonly cardId?: string;
  readonly cardToken?: string;
  /**
   * Kapida odemenin turu (T12.4). Odeme servisine GITMEZ; kayitli secimle
   * karsilastirilir (tekrar denemede degisemez).
   */
  readonly onDelivery?: DeliveryPaymentKind | undefined;
}

/** Odeme bekleyen siparisin tutarini ceker. Tekrar denemede ayni anahtar gider. */
export async function chargeOrder(
  deps: PaymentStepDeps,
  order: Order,
  choice: PaymentChoice,
  scope: RequestScope,
): Promise<CheckoutResult> {
  const policy = paymentPolicyOf(order);
  assertPaymentMethodAllowed(order.id, choice.method, policy);
  const windowed = await securePaymentWindow(deps, order, scope);
  if (windowed.status === ORDER_STATUS.PAID) {
    // Kilit dusmus gorundu ama onceki deneme cekip stogu kesinlestirmisti
    // (bekleyen is 124): siparis PAID yazildi, tekrar cekilmez.
    return { order: windowed };
  }
  // Odeme secimi cekimi belirler (T12.4): kayitlidan farkliysa CONFLICT. Kilit
  // durumu cozuldukten SONRA: dusmus kilit once dusus kurallarina gider (410).
  assertSamePayment(windowed, paymentChoiceOf(choice.method, choice.onDelivery));

  const result = await deps.payments.charge(
    {
      orderId: windowed.id,
      userId: windowed.userId,
      amountMinor: windowed.pricing.totalMinor,
      currency: windowed.pricing.currency,
      method: choice.method,
      ...(choice.cardId === undefined ? {} : { cardId: choice.cardId }),
      ...(choice.cardToken === undefined ? {} : { cardToken: choice.cardToken }),
      idempotencyKey: chargeIdempotencyKey(windowed.id),
      requireThreeDs: policy.requireThreeDs,
    },
    scope,
  );
  return settleOrderPayment(deps, windowed, choice.method, result, scope);
}

/** Odeme sonucunu siparise isler: PAID, PAYMENT_FAILED ya da 3DS beklemesi. */
export async function settleOrderPayment(
  deps: PaymentStepDeps,
  order: Order,
  method: PaymentMethod,
  result: PaymentResult,
  scope: RequestScope,
): Promise<CheckoutResult> {
  const decision = decidePayment(order.id, method, result);
  switch (decision.kind) {
    case 'awaiting-3ds':
      return {
        order,
        challengeId: decision.challengeId,
        ...(result.challengeExpiresAt === undefined
          ? {}
          : { challengeExpiresAt: result.challengeExpiresAt }),
      };
    case 'failed':
      await failPayment(deps, order, decision.code, scope);
      throw new AppError(decision.code, 'Odeme alinamadi', {
        details: { orderId: order.id, status: ORDER_STATUS.PAYMENT_FAILED },
      });
    case 'paid':
      await commitPaidStock(deps, order, result, scope);
      return { order: await markPaid(deps, order, result, decision.note, scope) };
  }
}

/**
 * Siparisi PAYMENT_FAILED yazar (not: hata anahtari) ve stok kilidini birakir:
 * stok baskasina acilir (T11.2). Hatayi CAGIRAN firlatir: 3DS kapanisinda
 * payment-svc'nin kendi hatasi (kalan hak, sebep) istemciye aynen gitmeli.
 * Cekim YAPILMADI; para telafisi gerekmez.
 */
export async function failPayment(
  deps: PaymentStepDeps,
  order: Order,
  code: ErrorCode,
  scope: RequestScope,
): Promise<Order> {
  const failed = transitionOrder(order, ORDER_STATUS.PAYMENT_FAILED, deps.clock, code);
  const written = await writeTransition(deps.repository, order, failed);
  await releaseStock(deps, order, RELEASE_REASON.PAYMENT_FAILED, scope);
  return written;
}

/**
 * Odenen siparisin kilidini kesinlestirir. Kilit dusmusse (suresi dolup
 * supurucu birakmis): kilidi dusmus siparisle ayni kapatma (lapsed-order.ts) -
 * CANCELLED, para alinmissa iade komutu ayni yazimda; RESERVATION_EXPIRED.
 * T11.2 oncesi acilmis, kilidi olmayan siparis kesinlestirilmez (gecis donemi).
 */
async function commitPaidStock(
  deps: PaymentStepDeps,
  order: Order,
  result: PaymentResult,
  scope: RequestScope,
): Promise<void> {
  if (order.reservation === undefined) {
    scope.logger.info(
      { orderId: order.id },
      'siparisin stok kilidi yok (T11.2 oncesi); kesinlestirme atlandi',
    );
    return;
  }
  const outcome = await commitStock(deps, order, scope);
  if (outcome !== SETTLEMENT.NOT_FOUND) {
    return;
  }
  const charged = result.status === PAYMENT_STATUS.SUCCEEDED;
  scope.logger.warn(
    { orderId: order.id, charged },
    'stok kilidi odeme sirasinda dusmustu; siparis iptal ediliyor',
  );
  await throwLapse(deps, order, await closeWithoutStock(deps, order, charged, scope));
}

async function markPaid(
  deps: PaymentStepDeps,
  order: Order,
  result: PaymentResult,
  note: string | undefined,
  scope: RequestScope,
): Promise<Order> {
  try {
    return await writePaid(deps, order, note);
  } catch (error) {
    if (isConflict(error) && result.status === PAYMENT_STATUS.SUCCEEDED) {
      await refundCharge(deps, order, REFUND_REASON.ORDER_CHANGED_DURING_PAYMENT, scope);
    }
    throw error;
  }
}
