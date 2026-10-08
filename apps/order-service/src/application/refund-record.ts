/**
 * Iade isaretinin AYRI yazimi (#166): siparisi baska yol iptal etmis, para sonra
 * iade edilmis (refund-step.ts: refundIfCancelledElsewhere ve
 * payment-step.ts markPaid cakismasi). Isaret siparisi Gecmis Siparislerim'de
 * tutar (order-history-listing.ts).
 *
 *   - recordRefund: dogrudan iade yapildi; yalniz isaret.
 *   - recordRefundWithCommand: dogrudan iade olmadi; isaret ve iade KOMUTU
 *     (payment.refund_requested) TEK yazimda, ayni transaction (#185 N5).
 *
 * En iyi gayretle: isaret yazilamazsa iade geri alinmaz, siparis gecmiste
 * gorunmez ve WARN yazilir (yalnizca kimlik ve gerekce; tutar ve kart bilgisi
 * YOK). Surum cakismasinda siparis yeniden okunur, en fazla
 * REFUND_RECORD_WRITE_ATTEMPTS deneme. Siparis iptal edilmemis (hala acik) ya da
 * zaten isaretliyse yazilmaz.
 */

import type { Clock } from '@getir/core';

import { REFUND_RECORD_WRITE_ATTEMPTS } from '../config/constants.js';
import { refundRequestedEvent } from '../domain/order-events.js';
import type { RefundRequest } from '../domain/order-events.js';
import type { OrderRepository } from '../domain/order-repository.js';
import { needsRefundRecord, recordedRefund } from '../domain/order-refund.js';
import { isConflict } from './order-transition.js';
import type { RequestScope } from './request-scope.js';

export interface RefundRecordDeps {
  readonly repository: Pick<OrderRepository, 'findById' | 'update'>;
  readonly clock: Clock;
}

/** Yazim denemesinin sonucu: yazildi, yazilacak bir sey yok ya da cakisti. */
type RecordWrite = 'written' | 'skipped' | 'conflict';

/** Iptal edilmis siparise iade isaretini yazar; hata firlatmaz. */
export async function recordRefund(
  deps: RefundRecordDeps,
  orderId: string,
  reason: string,
  scope: RequestScope,
): Promise<void> {
  try {
    if ((await recordWithRetries(deps, orderId, reason, undefined)) === 'conflict') {
      scope.logger.warn(
        { orderId, reason },
        'iade isareti yazilamadi (surum cakismasi surdu); siparis gecmiste gorunmeyecek',
      );
    }
  } catch (error: unknown) {
    scope.logger.warn(
      { err: error, orderId, reason },
      'iade isareti yazilamadi; siparis gecmiste gorunmeyecek',
    );
  }
}

/**
 * Isaret ve iade komutu TEK yazimda; hata firlatmaz. @returns ikisi birlikte
 * yazildi mi? false: siparis acik ya da zaten isaretli, cakisma surdu ya da yazim
 * dustu - cagiran komutu tek basina yazar (once para).
 */
export async function recordRefundWithCommand(
  deps: RefundRecordDeps,
  orderId: string,
  request: RefundRequest,
  scope: RequestScope,
): Promise<boolean> {
  try {
    const write = await recordWithRetries(deps, orderId, request.reason, request);
    if (write === 'conflict') {
      scope.logger.warn(
        { orderId, reason: request.reason },
        'iade isareti yazilamadi (surum cakismasi surdu); iade komutu tek basina yazilacak',
      );
    }
    return write === 'written';
  } catch (error: unknown) {
    scope.logger.warn(
      { err: error, orderId, reason: request.reason },
      'iade isareti yazilamadi; iade komutu tek basina yazilacak',
    );
    return false;
  }
}

async function recordWithRetries(
  deps: RefundRecordDeps,
  orderId: string,
  reason: string,
  command: RefundRequest | undefined,
): Promise<RecordWrite> {
  for (let attempt = 1; attempt <= REFUND_RECORD_WRITE_ATTEMPTS; attempt += 1) {
    const write = await tryRecord(deps, orderId, reason, command);
    if (write !== 'conflict') {
      return write;
    }
  }
  return 'conflict';
}

/** Son hali okur; iptal edilmis ve isaretsizse isareti (ve varsa komutu) yazar. */
async function tryRecord(
  deps: RefundRecordDeps,
  orderId: string,
  reason: string,
  command: RefundRequest | undefined,
): Promise<RecordWrite> {
  const latest = await deps.repository.findById(orderId);
  if (latest === null || !needsRefundRecord(latest)) {
    return 'skipped';
  }
  const at = deps.clock.date();
  const marked = recordedRefund(latest, { reason, requestedAt: at }, deps.clock);
  const events = command === undefined ? [] : [refundRequestedEvent(marked, command, at)];
  try {
    await deps.repository.update(marked, latest.version, events);
    return 'written';
  } catch (error: unknown) {
    if (isConflict(error)) {
      return 'conflict';
    }
    throw error;
  }
}
