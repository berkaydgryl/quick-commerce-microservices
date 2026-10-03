/**
 * order.status_changed tuketicisi (T12.3): siparisin durum gecisi odaya yayinlanir.
 *
 * gRPC handler'i kadar incedir: govdeyi dogrular, use-case'i cagirir, sonucu olay
 * hattinin diline cevirir (payment'taki kalip):
 *
 *   yayinlandi / yeniden yayinlandi / eski surum atlandi / yayin kapisi atti -> islendi
 *   govde sozlesme disi -> REDDEDILIR: tekrar denemek sonucu degistirmez (olu olaylar, D8)
 *   Redis hatasi (surum kaydi) -> firlatilir: olay onaylanmaz, yeniden teslim edilir
 *
 * Gunlukcu event-bus'tan gelir ve zarfin requestId'sini tasir (D16): siparisi
 * degistiren istegin gunluk zinciri realtime'a kadar uzanir.
 */

import { orderStatusChangedPayloadSchema } from '@getir/contracts';
import { EVENT_HANDLED, rejectEvent } from '@getir/event-bus';
import type { EventHandler } from '@getir/event-bus';

import { PUBLISH_OUTCOME } from '../../application/publish-order-status.js';
import type { PublishOrderStatus, PublishOutcome } from '../../application/publish-order-status.js';

export interface OrderStatusChangedDeps {
  readonly publish: PublishOrderStatus;
}

const OUTCOME_MESSAGE: Readonly<Record<PublishOutcome, string>> = {
  [PUBLISH_OUTCOME.PUBLISHED]: 'siparis durumu odaya yayinlandi',
  [PUBLISH_OUTCOME.REPUBLISHED]: 'siparis durumu yeniden yayinlandi (ayni surum tekrar geldi)',
  [PUBLISH_OUTCOME.STALE]: 'siparis durumu atlandi: daha yeni surum yayinlanmisti',
  [PUBLISH_OUTCOME.DROPPED]: 'siparis durumu yayinlanmadi: soket sozlesmesine uymuyor',
};

export function createOrderStatusChangedHandler(deps: OrderStatusChangedDeps): EventHandler {
  return async (envelope, { logger }) => {
    const parsed = orderStatusChangedPayloadSchema.safeParse(envelope.payload);
    if (!parsed.success) {
      return rejectEvent(
        `durum degisimi govdesi sozlesmeye uymuyor: ${parsed.error.issues
          .map((issue) => issue.path.join('.'))
          .join(', ')}`,
      );
    }
    const { orderId, to, version } = parsed.data;
    const { outcome } = await deps.publish({
      payload: parsed.data,
      occurredAt: envelope.occurredAt,
    });
    logger.info({ orderId, status: to, seq: version, outcome }, OUTCOME_MESSAGE[outcome]);
    return EVENT_HANDLED;
  };
}
