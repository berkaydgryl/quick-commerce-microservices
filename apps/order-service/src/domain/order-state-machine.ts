/**
 * Siparis durum makinesi (saf) - roadmap "Siparis Durum Makinesi ve Saga".
 *
 * Siparis durumunu yazabilen TEK yer order-service'tir ve her gecis bu
 * tablodan gecer. Tabloda olmayan gecis SESSIZCE GECILMEZ: ORDER_STATE_INVALID
 * firlatir (gRPC'de FAILED_PRECONDITION). Tablo Record<OrderStatus, ...>
 * oldugu icin @getir/core'a yeni bir durum eklenip buraya eklenmezse DERLEME
 * kirilir.
 *
 * Kaynaklar: roadmap diyagrami + B20 (REVIEW, RISK_CHECK -> CANCELLED,
 * PAID -> CANCELLED) + B29 (kullanici iptali: DRAFT, RESERVED,
 * AWAITING_PAYMENT -> CANCELLED; T4.4'te bulundu).
 */

import { AppError, ERROR_CODES, ORDER_STATUS } from '@getir/core';
import type { OrderStatus } from '@getir/core';

const S = ORDER_STATUS;

/** Her durumdan gidilebilecek durumlar. Bos dizi = son durum. */
export const ORDER_TRANSITIONS: Readonly<Record<OrderStatus, readonly OrderStatus[]>> = {
  // B29: kullanici sepeti rezerve etmeden vazgecebilir.
  [S.DRAFT]: [S.RISK_CHECK, S.CANCELLED],
  // B20(b): stok yetersizse taslak CANCELLED olur.
  [S.RISK_CHECK]: [S.REJECTED, S.REVIEW, S.RESERVED, S.CANCELLED],
  // B20(a): 66-85 bandi inceleme kuyrugu.
  [S.REVIEW]: [S.RESERVED, S.REJECTED],
  // B29: kullanici rezervasyonu serbest birakabilir (DELETE /v1/cart/reserve).
  [S.RESERVED]: [S.AWAITING_PAYMENT, S.EXPIRED, S.CANCELLED],
  // B29: kullanici odeme ekraninda vazgecebilir.
  [S.AWAITING_PAYMENT]: [S.PAID, S.PAYMENT_FAILED, S.CANCELLED],
  [S.PAYMENT_FAILED]: [S.CANCELLED],
  [S.EXPIRED]: [S.CANCELLED],
  // B20(c): commit ZREM 0 donerse odeme iade edilir, siparis CANCELLED.
  [S.PAID]: [S.PREPARING, S.CANCELLED],
  [S.PREPARING]: [S.ON_THE_WAY],
  [S.ON_THE_WAY]: [S.DELIVERED],
  [S.DELIVERED]: [],
  [S.CANCELLED]: [],
  [S.REJECTED]: [],
};

/**
 * Kullanicinin KENDISININ iptal edebildigi durumlar (CancelOrder).
 *
 * Tabloda CANCELLED'a giden baska kenarlar da var (RISK_CHECK, PAYMENT_FAILED,
 * EXPIRED, PAID) ama onlari SISTEM yurutur: odenmis siparisi kullanici iptal
 * edemez, iade saga'nin telafi adimidir (B20c). REVIEW'daki siparis de
 * incelemenin sonucunu bekler.
 */
export const USER_CANCELLABLE: ReadonlySet<OrderStatus> = new Set([
  S.DRAFT,
  S.RESERVED,
  S.AWAITING_PAYMENT,
]);

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return ORDER_TRANSITIONS[from].includes(to);
}

export function isTerminal(status: OrderStatus): boolean {
  return ORDER_TRANSITIONS[status].length === 0;
}

/** Tablo disi gecis: ORDER_STATE_INVALID. Ayrinti hangi gecisin denendigini soyler. */
export function assertTransition(orderId: string, from: OrderStatus, to: OrderStatus): void {
  if (!canTransition(from, to)) {
    throw new AppError(ERROR_CODES.ORDER_STATE_INVALID, `Gecersiz durum gecisi: ${from} -> ${to}`, {
      details: { orderId, from, to },
    });
  }
}
