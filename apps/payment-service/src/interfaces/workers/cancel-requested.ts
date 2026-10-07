/**
 * payment.cancel_requested tuketicisi (T11.2 PR 3): siparis odeme asamasindan
 * CANCELLED'a gecti; tahsil edilmemis odeme kapatilir. Order komutu siparisi
 * iptal eden yazimla AYNI transaction'da outbox'a yazar.
 *
 * gRPC handler'i kadar incedir: govdeyi dogrular, CancelPayment use-case'ini
 * cagirir, sonucu olay hattinin diline cevirir:
 *
 *   kapatildi / zaten kapali / kapatilacak bir sey yok / odeme yok -> islendi
 *   para alinmisti, iade edildi ya da zaten iade edilmisti (T15.3) -> islendi
 *   govde bozuk -> REDDEDILIR: tekrar denemek sonucu degistirmez (olu olaylar)
 *   kart cekimi suruyor, veritabani kapali, surum cakismasi, iade hatasi ->
 *     firlatilir: olay onaylanmaz, bir sure sonra yeniden teslim edilir; hak
 *     bitince (@getir/event-bus maxDeliveries, 5) olu olaylara tasinir, ERROR
 *     yazilir ve event_consumer_events_total{outcome="dead"} artar
 */

import { paymentCancelRequestedPayloadSchema } from '@getir/contracts';
import { EVENT_HANDLED, rejectEvent } from '@getir/event-bus';
import type { EventHandler } from '@getir/event-bus';

import { CANCEL_OUTCOME } from '../../application/cancel-payment.js';
import type { CancelOutcome, CancelPayment } from '../../application/cancel-payment.js';

export interface CancelRequestedDeps {
  readonly cancel: CancelPayment;
}

const OUTCOME_MESSAGE: Readonly<Record<CancelOutcome, string>> = {
  [CANCEL_OUTCOME.CANCELLED]: 'iptal komutu: tahsil edilmemis odeme kapatildi',
  [CANCEL_OUTCOME.ALREADY_CANCELLED]: 'iptal komutu: odeme zaten kapatilmisti',
  [CANCEL_OUTCOME.NOTHING_TO_CANCEL]: 'iptal komutu: kapatilacak tahsilat yok (odeme sonuclanmis)',
  [CANCEL_OUTCOME.NO_PAYMENT]: 'iptal komutu: siparisin odeme kaydi yok',
  [CANCEL_OUTCOME.REFUNDED]: 'iptal komutu: iptal edilen sipariste alinmis tutar iade edildi',
  [CANCEL_OUTCOME.ALREADY_REFUNDED]: 'iptal komutu: alinmis tutar zaten iade edilmisti',
};

export function createCancelRequestedHandler(deps: CancelRequestedDeps): EventHandler {
  return async (envelope, { logger }) => {
    const parsed = paymentCancelRequestedPayloadSchema.safeParse(envelope.payload);
    if (!parsed.success) {
      return rejectEvent(
        `iptal komutu govdesi sozlesmeye uymuyor: ${parsed.error.issues
          .map((issue) => issue.path.join('.'))
          .join(', ')}`,
      );
    }
    const { orderId, reason } = parsed.data;
    const { outcome, payment } = await deps.cancel({ orderId, reason });
    // Iptal edilen sipariste para alinmis olmasi bir yarisin izidir (T15.3): WARN.
    // Tutar ve kart bilgisi YAZILMAZ: yalnizca kimlik, sonuc ve durum.
    const level = outcome === CANCEL_OUTCOME.REFUNDED ? 'warn' : 'info';
    logger[level]({ orderId, outcome, status: payment?.status }, OUTCOME_MESSAGE[outcome]);
    return EVENT_HANDLED;
  };
}
