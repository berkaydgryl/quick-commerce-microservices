/**
 * Siparisin kalici iade isareti (#166). Saf: I/O yok.
 *
 * Para alinmis ama siparis tamamlanamamis (kilidi dusmus odeme, odeme
 * sirasinda baska yolun iptali) ve tutar iade edilmeye baslanmissa siparis
 * bunu tasir: Gecmis Siparislerim'de "Iptal edildi · Iade edildi" olarak kalir
 * (order-history-listing.ts). Iki yazim yolu:
 *
 *   ayni yazim  - siparisi KENDISI iptal eden yol (stockless-close.ts cancelLapsed):
 *                 CANCELLED ve iade komutu ile birlikte (withRefund)
 *   ayri yazim  - siparisi BASKA yol iptal etmis, para sonra iade edilmis
 *                 (refund-step.ts): durum disi guncelleme, surum +1, zaman
 *                 cizelgesine kayit ve olay yok (recordedRefund)
 */

import { ORDER_STATUS } from '@getir/core';
import type { Clock } from '@getir/core';

import { REFUND_REASON } from './checkout-payment.js';
import type { Order, OrderRefund } from './order.js';

/**
 * Isaretin gerekceleri TEK sozlukte: iade komutunun gerekceleri (REFUND_REASON;
 * payment-svc'ye giden komut yalniz bunlari tasir) ve komutsuz isaretin
 * gerekcesi. Goc 0003 gerekceyi outbox'taki komuttan alir.
 */
export const REFUND_MARK_REASON = {
  ...REFUND_REASON,
  /**
   * Odeme kaydi kapanista ZATEN iade edilmis bulundu (supurucu: GetPayment
   * REFUNDED); komut yazilmaz. Iadenin asil gerekcesi payment'tadir.
   */
  PAYMENT_ALREADY_REFUNDED: 'payment_refunded',
} as const;

export type RefundMarkReason = (typeof REFUND_MARK_REASON)[keyof typeof REFUND_MARK_REASON];

/** Iade isaretini ayni yazima ekler (surum degismez; gecis zaten artirdi). */
export function withRefund(order: Order, refund: OrderRefund): Order {
  return { ...order, refund };
}

/** Ayri yazimla isaretlenmeli mi: iptal edilmis ve henuz isaretsiz. */
export function needsRefundRecord(order: Order): boolean {
  return order.status === ORDER_STATUS.CANCELLED && order.refund === undefined;
}

/**
 * Iptal edilmis siparise iade isaretini ayri yazimla ekler: durum disi
 * guncelleme, surum bir artar (iki yazim birbirini sessizce ezmesin).
 */
export function recordedRefund(order: Order, refund: OrderRefund, clock: Clock): Order {
  return { ...order, refund, updatedAt: clock.date(), version: order.version + 1 };
}
