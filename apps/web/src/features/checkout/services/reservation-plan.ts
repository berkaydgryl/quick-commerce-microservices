import type { ReserveCartRequest } from '@getir/contracts';

import { heldExpiresAt, heldFingerprint } from './held-order';
import type { HeldOrder } from './held-order';

/**
 * Erken rezervasyonun durumu (T12.4; PM K4): odeme sayfasi acikken sepet
 * ayrilir, "Sipariş Ver" yalnizca siparisi verir (risk checkout-dwell sayfada
 * gecen gercek sureyi olcer).
 */
export type ReservationPhase =
  | { readonly kind: 'none' }
  | { readonly kind: 'reserving'; readonly fingerprint: string }
  | { readonly kind: 'held'; readonly held: HeldOrder }
  | { readonly kind: 'failed'; readonly fingerprint: string; readonly error: unknown }
  /** Siparis verildi (odendi, incelemede ya da 3DS suruyor): rezervasyon siparisin; ASLA birakilmaz. */
  | { readonly kind: 'ordered'; readonly orderId: string };

/**
 * Siradaki is:
 *   - reserve: kosullar saglandi, rezervasyon yok (ya da hata alinan istek degisti);
 *   - replace: sepet, adres ya da tutar degisti: eskisi birakilir, yenisi alinir;
 *   - renew: suresi doldu: yeni niyetle yeniden alinir (sessiz, bildirimle);
 *   - release: kosul kalkti (sepet bosaldi, adres kalkti, market kapandi);
 *   - wait: yapilacak bir sey yok (ya da istek suruyor, siparis verildi).
 */
export type ReservationStep = 'wait' | 'reserve' | 'replace' | 'renew' | 'release';

export function reservationStep(
  phase: ReservationPhase,
  request: ReserveCartRequest | undefined,
  now: number,
): ReservationStep {
  if (phase.kind === 'ordered' || phase.kind === 'reserving') {
    return 'wait';
  }
  if (request === undefined) {
    return phase.kind === 'held' ? 'release' : 'wait';
  }
  const fingerprint = heldFingerprint(request);
  switch (phase.kind) {
    case 'none':
      return 'reserve';
    case 'failed':
      return phase.fingerprint === fingerprint ? 'wait' : 'reserve';
    case 'held': {
      if (phase.held.fingerprint !== fingerprint) {
        return 'replace';
      }
      const expiresAt = heldExpiresAt(phase.held);
      return expiresAt !== undefined && now >= expiresAt ? 'renew' : 'wait';
    }
  }
}

/** Sayfadan ayrilinca birakilacak rezervasyon: yalnizca siparisi VERILMEMIS olan (PM ek sart). */
export function releasableOnLeave(phase: ReservationPhase): HeldOrder | undefined {
  return phase.kind === 'held' ? phase.held : undefined;
}
