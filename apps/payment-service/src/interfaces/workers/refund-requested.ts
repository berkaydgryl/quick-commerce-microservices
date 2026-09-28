/**
 * payment.refund_requested tuketicisi (T7.4): siparis saga'sinin KALICI telafi
 * komutu. Tutar alindi ama siparis PAID yazilamadi ve order'in dogrudan iade
 * cagrisi da basarisiz oldu (T7.1); order komutu outbox'a yazdi (T7.3).
 *
 * gRPC handler'i kadar incedir: govdeyi dogrular, Refund use-case'ini cagirir,
 * sonucu olay hattinin diline cevirir:
 *
 *   iade edildi / zaten iade edilmis  -> islendi (olay onaylanir)
 *   govde bozuk, odeme yok, odeme iade edilemez durumda -> REDDEDILIR: tekrar
 *     denemek sonucu degistirmez, olay beklemeden olu olaylara gider (ERROR)
 *   diger her hata (veritabani kapali, surum cakismasi) -> firlatilir: olay
 *     onaylanmaz, bir sure sonra yeniden teslim edilir
 *
 * Teslimat en az bir kezdir: ayni komut iki kez gelirse ikincisi "zaten iade
 * edilmis" gorur - para iki kez geri verilmez (Refund use-case'i).
 */

import { refundRequestedPayloadSchema } from '@getir/contracts';
import { ERROR_CODES, isAppError } from '@getir/core';
import { EVENT_HANDLED, rejectEvent } from '@getir/event-bus';
import type { EventHandler } from '@getir/event-bus';

import type { Refund } from '../../application/refund.js';
import { PaymentNotRefundableError } from '../../domain/refund.js';

export interface RefundRequestedDeps {
  readonly refund: Refund;
}

export function createRefundRequestedHandler(deps: RefundRequestedDeps): EventHandler {
  return async (envelope, { logger }) => {
    const parsed = refundRequestedPayloadSchema.safeParse(envelope.payload);
    if (!parsed.success) {
      return rejectEvent(
        `iade komutu govdesi sozlesmeye uymuyor: ${parsed.error.issues
          .map((issue) => issue.path.join('.'))
          .join(', ')}`,
      );
    }
    const { orderId, reason } = parsed.data;
    try {
      const { alreadyRefunded } = await deps.refund({ orderId, reason });
      logger.info(
        { orderId, alreadyRefunded },
        alreadyRefunded
          ? 'iade komutu: odeme zaten iade edilmisti'
          : 'iade komutu: odeme iade edildi',
      );
      return EVENT_HANDLED;
    } catch (error: unknown) {
      if (isPermanentRefundFailure(error)) {
        return rejectEvent('iade yapilamaz', error);
      }
      throw error;
    }
  };
}

/** Tekrar denenince degismeyecek sonuc: odeme yok ya da iade edilebilir durumda degil. */
function isPermanentRefundFailure(error: unknown): boolean {
  return (
    error instanceof PaymentNotRefundableError ||
    (isAppError(error) && error.code === ERROR_CODES.NOT_FOUND)
  );
}
