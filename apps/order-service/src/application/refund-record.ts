/**
 * Iade isaretinin AYRI yazimi (#166): siparisi baska yol iptal etmis, para sonra
 * iade edilmis (refund-step.ts: refundIfCancelledElsewhere ve
 * payment-step.ts markPaid cakismasi). Isaret siparisi Gecmis Siparislerim'de
 * "Iptal edildi · Iade edildi" olarak tutar (order-history-listing.ts).
 *
 * En iyi gayretle: iade zaten yapildi ya da istendi; isaret yazilamazsa iade
 * geri alinmaz, siparis gecmiste gorunmez ve WARN yazilir (yalnizca kimlik ve
 * gerekce; tutar ve kart bilgisi YOK). Surum cakismasinda siparis yeniden
 * okunur, en fazla REFUND_RECORD_WRITE_ATTEMPTS deneme. Siparis iptal edilmemis
 * (hala acik) ya da zaten isaretliyse yazilmaz.
 */

import type { Clock } from '@getir/core';

import { REFUND_RECORD_WRITE_ATTEMPTS } from '../config/constants.js';
import type { OrderRepository } from '../domain/order-repository.js';
import { needsRefundRecord, recordedRefund } from '../domain/order-refund.js';
import { isConflict } from './order-transition.js';
import type { RequestScope } from './request-scope.js';

export interface RefundRecordDeps {
  readonly repository: Pick<OrderRepository, 'findById' | 'update'>;
  readonly clock: Clock;
}

/** Iptal edilmis siparise iade isaretini yazar; hata firlatmaz. */
export async function recordRefund(
  deps: RefundRecordDeps,
  orderId: string,
  reason: string,
  scope: RequestScope,
): Promise<void> {
  try {
    for (let attempt = 1; attempt <= REFUND_RECORD_WRITE_ATTEMPTS; attempt += 1) {
      if (await tryRecord(deps, orderId, reason)) {
        return;
      }
    }
    scope.logger.warn(
      { orderId, reason },
      'iade isareti yazilamadi (surum cakismasi surdu); siparis gecmiste gorunmeyecek',
    );
  } catch (error: unknown) {
    scope.logger.warn(
      { err: error, orderId, reason },
      'iade isareti yazilamadi; siparis gecmiste gorunmeyecek',
    );
  }
}

/** @returns bitti mi? (yazildi ya da yazilacak bir sey yok); false: cakisma. */
async function tryRecord(
  deps: RefundRecordDeps,
  orderId: string,
  reason: string,
): Promise<boolean> {
  const latest = await deps.repository.findById(orderId);
  if (latest === null || !needsRefundRecord(latest)) {
    return true;
  }
  const marked = recordedRefund(latest, { reason, requestedAt: deps.clock.date() }, deps.clock);
  try {
    await deps.repository.update(marked, latest.version, []);
    return true;
  } catch (error: unknown) {
    if (isConflict(error)) {
      return false;
    }
    throw error;
  }
}
