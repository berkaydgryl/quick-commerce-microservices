/**
 * Yetim stok kilidi metrigi (T15.3; bekleyen is 126).
 *
 *  - order_orphan_locks_released_total: siparis KAYDI olmayan (Reserve cevabi
 *    kaybolmus) ve yeterince eski kilit, kullanicinin yeni sepeti icin
 *    birakildi (application/draft-reservation.ts). Sifirdan buyukse Reserve'in
 *    cevap kaybi ya da gec yazim (Redis donmasi) yasaniyordur.
 *
 * Etiket yok: siparis ya da kullanici kimligi etiket olmaz (kural:
 * @getir/observability metrics/registry.ts). Kilidin yasi gunluk satirindadir.
 */

import { counter } from '@getir/observability';

export const ORPHAN_LOCK_METRICS = {
  RELEASED: 'order_orphan_locks_released_total',
} as const;

const released = counter({
  name: ORPHAN_LOCK_METRICS.RELEASED,
  help: 'Siparis kaydi olmayan (yetim) ve yeterince eski stok kilidi birakildi',
});

/** Yetim kilit birakildi (draft-reservation.ts gozlemcisi). */
export function recordOrphanLockReleased(): void {
  released.inc();
}
