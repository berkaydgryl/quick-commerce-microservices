/**
 * Siparis takip cizgisi (F21; 07.10 kullanici karari): durum makinesinin
 * dugumleri uc adima iner. Saf fonksiyonlar; metin icerikten.
 *
 *   preparing - Siparişin hazırlanıyor (PAID, PREPARING)
 *   onTheWay  - Kurye yolda (ON_THE_WAY)
 *   delivered - Siparişin teslim edildi (DELIVERED)
 *
 * Odeme oncesi, inceleme ve iptal ailesinde cizgi yoktur (null; PM S2 a).
 * Tablo durum tipinin TAMAMINI anahtar alir: ORDER_STATUS'a dugum eklenirse
 * derleme burada durur.
 */

import type { OrderStatus } from '@getir/contracts';

export type TrackStep = 'preparing' | 'onTheWay' | 'delivered';

/** Adimlarin sirasi (soldan saga). */
export const TRACK_STEPS: readonly TrackStep[] = ['preparing', 'onTheWay', 'delivered'];

const STATUS_STEP: Readonly<Record<OrderStatus, TrackStep | null>> = {
  DRAFT: null,
  RISK_CHECK: null,
  REVIEW: null,
  RESERVED: null,
  AWAITING_PAYMENT: null,
  PAID: 'preparing',
  PREPARING: 'preparing',
  ON_THE_WAY: 'onTheWay',
  DELIVERED: 'delivered',
  CANCELLED: null,
  REJECTED: null,
  PAYMENT_FAILED: null,
  EXPIRED: null,
};

/** Siparisin bulundugu adim; cizgi disi durumda null. */
export function trackStep(status: OrderStatus): TrackStep | null {
  return STATUS_STEP[status];
}

/** Gecilen (mor), aktif (mor, yanip soner) ya da gelecek (bos). */
export type TrackStepState = 'done' | 'current' | 'upcoming';

/**
 * Adimin gorunumu. Teslim edildiyse uc adim da gecilmistir: dolu mor ve
 * sabit, yanip sonme yok (PM S1 a; siparis bitti).
 */
export function trackStepState(step: TrackStep, current: TrackStep): TrackStepState {
  const index = TRACK_STEPS.indexOf(step);
  const at = TRACK_STEPS.indexOf(current);
  if (index < at || current === 'delivered') {
    return 'done';
  }
  return index === at ? 'current' : 'upcoming';
}

/** Siparisin son durumlari: bundan sonra durum degismez. */
const FINAL_STATUSES: ReadonlySet<OrderStatus> = new Set<OrderStatus>([
  'DELIVERED',
  'CANCELLED',
  'REJECTED',
  'PAYMENT_FAILED',
  'EXPIRED',
]);

/**
 * Detay yoklansin mi: siparis son durumda degilse. Inceleme ve odeme
 * bekleyen siparis de (cizgi disi) yoklanir; onaylaninca cizgi kendiliginden
 * gelir. Teslimde, iptal ailesinde ve durum henuz yokken yoklama yok.
 */
export function shouldPollOrder(status: OrderStatus | undefined): boolean {
  return status !== undefined && !FINAL_STATUSES.has(status);
}
