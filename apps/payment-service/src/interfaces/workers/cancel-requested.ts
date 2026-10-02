/**
 * payment.cancel_requested tuketicisi (T11.2 PR 3): siparis odeme asamasindan
 * CANCELLED'a gecti; tahsil edilmemis odeme kapatilir. Order komutu siparisi
 * iptal eden yazimla AYNI transaction'da outbox'a yazar.
 *
 * gRPC handler'i kadar incedir: govdeyi dogrular, CancelPayment use-case'ini
 * cagirir, sonucu olay hattinin diline cevirir:
 *
 *   kapatildi / zaten kapali / kapatilacak bir sey yok / odeme yok -> islendi
 *   govde bozuk -> REDDEDILIR: tekrar denemek sonucu degistirmez (olu olaylar)
 *   kart cekimi suruyor, veritabani kapali, surum cakismasi -> firlatilir:
 *     olay onaylanmaz, bir sure sonra yeniden teslim edilir
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
    logger.info({ orderId, outcome, status: payment?.status }, OUTCOME_MESSAGE[outcome]);
    return EVENT_HANDLED;
  };
}
