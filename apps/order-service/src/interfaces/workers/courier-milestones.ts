/**
 * Kurye kilometre tasi tuketicileri (T14.3): courier.picked_up ve
 * courier.delivered -> RecordCourierMilestone use-case.
 *
 * gRPC handler'i kadar incedir: govdeyi sozlesme semasindan gecirir,
 * use-case'i cagirir, sonucu olay hattinin diline cevirir:
 *
 *   ilerledi / tekrar / eski olay / kapanmis siparis -> islendi (onaylanir)
 *   govde bozuk, siparis yok -> REDDEDILIR: tekrar denemek sonucu degistirmez,
 *     olay beklemeden olu olaylara gider (ERROR)
 *   kurye henuz yazilmamis (PAID, kuryesiz PREPARING) -> FIRLATILIR: olay
 *     onaylanmaz, takilma suresinden sonra yeniden teslim edilir; hak bitince
 *     (@getir/event-bus maxDeliveries) olu olaylara tasinir
 *   diger hata (veritabani kapali, ust uste surum cakismasi) -> firlatilir
 *
 * Gunluk yalnizca kimlik ve sonuc yazar: yukun geri kalani (ileride konum ya da
 * rota gelse bile) semadan gecmez ve gunluge girmez (kisisel veri).
 */

import { courierDeliveredPayloadSchema, courierPickedUpPayloadSchema } from '@getir/contracts';
import { AppError, ERROR_CODES } from '@getir/core';
import type { Logger } from '@getir/core';
import { EVENT_HANDLED, rejectEvent } from '@getir/event-bus';
import type { EventHandler, EventOutcome } from '@getir/event-bus';
import type { z } from 'zod';

import type {
  MilestoneResult,
  RecordCourierMilestone,
} from '../../application/record-courier-milestone.js';
import { COURIER_MILESTONE } from '../../domain/courier-milestone.js';
import type { CourierMilestone } from '../../domain/courier-milestone.js';

export interface CourierMilestoneDeps {
  readonly record: RecordCourierMilestone;
}

/** courier.picked_up: PREPARING -> ON_THE_WAY. */
export function createCourierPickedUpHandler(deps: CourierMilestoneDeps): EventHandler {
  return async (envelope, { logger }) => {
    const parsed = courierPickedUpPayloadSchema.safeParse(envelope.payload);
    if (!parsed.success) {
      return rejectEvent(malformed('paket alindi', parsed.error));
    }
    const { orderId, courierId, marketId } = parsed.data;
    const milestone: CourierMilestone = { kind: COURIER_MILESTONE.PICKED_UP, courierId, marketId };
    const occurredAt = new Date(envelope.occurredAt);
    return settle(
      orderId,
      milestone,
      await deps.record({ orderId, milestone, occurredAt }),
      logger,
    );
  };
}

/** courier.delivered: -> DELIVERED (PREPARING'den iki gecis). */
export function createCourierDeliveredHandler(deps: CourierMilestoneDeps): EventHandler {
  return async (envelope, { logger }) => {
    const parsed = courierDeliveredPayloadSchema.safeParse(envelope.payload);
    if (!parsed.success) {
      return rejectEvent(malformed('teslim edildi', parsed.error));
    }
    const { orderId, courierId } = parsed.data;
    const milestone: CourierMilestone = { kind: COURIER_MILESTONE.DELIVERED, courierId };
    const occurredAt = new Date(envelope.occurredAt);
    return settle(
      orderId,
      milestone,
      await deps.record({ orderId, milestone, occurredAt }),
      logger,
    );
  };
}

function malformed(name: string, error: z.ZodError): string {
  return `kurye olayi (${name}) govdesi sozlesmeye uymuyor: ${error.issues
    .map((issue) => issue.path.join('.'))
    .join(', ')}`;
}

/** Sonucu olay hattinin kararina cevirir ve gunluge yazar (yalnizca kimlik ve durum). */
function settle(
  orderId: string,
  milestone: CourierMilestone,
  result: MilestoneResult,
  logger: Logger,
): EventOutcome {
  const fields = { orderId, courierId: milestone.courierId, milestone: milestone.kind };
  switch (result.outcome) {
    case 'advanced':
      logger.info(
        { ...fields, from: result.from, to: result.to },
        'kurye kilometre tasi: siparis ilerledi',
      );
      return EVENT_HANDLED;
    case 'duplicate':
      // Kurye olayi yayinlandi isaretine kadar her turda yeniden basar: gurultu olmasin.
      logger.debug(
        { ...fields, status: result.status },
        'kurye kilometre tasi: tekrar, yok sayildi',
      );
      return EVENT_HANDLED;
    case 'stale':
      logger.warn(
        { ...fields, status: result.status, field: result.field },
        'kurye kilometre tasi: siparisin kuryesine ya da marketine uymuyor (eski olay), yok sayildi',
      );
      return EVENT_HANDLED;
    case 'ignored':
      logger.info(
        { ...fields, status: result.status },
        'kurye kilometre tasi: siparis bu olayi beklemiyor (odeme oncesi ya da kapanmis), yok sayildi',
      );
      return EVENT_HANDLED;
    case 'unknown-order':
      return rejectEvent('kurye olayinin siparisi yok');
    case 'not-yet':
      throw new AppError(
        ERROR_CODES.ORDER_STATE_INVALID,
        'Siparise kurye henuz yazilmadi; kurye olayi yeniden teslim edilecek',
        { details: { orderId, status: result.status } },
      );
  }
}
