/**
 * Use-case: kurye kilometre tasini (paket alindi, teslim edildi) siparise
 * isler (T14.3). Kural domain/courier-milestone.ts'te; burada okuma, surum
 * kontrollu yazim ve cakismada yeniden karar var.
 *
 * Yazim tek transaction'dir: gecis(ler) ve order.status_changed olaylari outbox'a
 * siparisle birlikte yazilir (T7.3). Cakismada siparis yeniden okunur ve karar
 * guncel halden yeniden verilir (tekrar mi oldu, hala ilerlemeli mi); en fazla
 * COURIER_MILESTONE_WRITE_ATTEMPTS deneme, sonra cakisma hatasi yukari gider.
 *
 * Sonucu olay hattinin diline cevirmek (onayla, reddet, yeniden teslim)
 * interfaces/workers/courier-milestones.ts'in isidir.
 */

import type { Clock, OrderStatus } from '@getir/core';

import { advanceOrder, decideMilestone, milestoneTime } from '../domain/courier-milestone.js';
import type {
  CourierMilestone,
  MilestoneDecision,
  StaleField,
} from '../domain/courier-milestone.js';
import type { Order } from '../domain/order.js';
import { tryWriteTransition } from './order-transition.js';
import type { TransitionRepository } from './order-transition.js';

export interface RecordCourierMilestoneDeps {
  readonly repository: TransitionRepository;
  readonly clock: Clock;
  /** Surum cakismasinda en fazla kac yazim denemesi. */
  readonly writeAttempts: number;
}

export interface RecordCourierMilestoneInput {
  readonly orderId: string;
  readonly milestone: CourierMilestone;
  /** Olayin ani (zarfin occurredAt'i): gecisler bu anla yazilir (milestoneTime). */
  readonly occurredAt: Date;
}

/**
 * Sonuc:
 *   advanced      - gecis(ler) yazildi; `from` -> `to`
 *   not-yet       - siparise kurye henuz yazilmamis (PAID, kuryesiz PREPARING):
 *                   olay onaylanmamali, yeniden teslim edilmeli
 *   stale         - olayin kuryesi (picked_up'ta marketi) siparisinkine uymuyor
 *   duplicate     - siparis zaten hedefte ya da ilerisinde
 *   ignored       - odeme oncesi ya da kapanmis siparis (CANCELLED, REJECTED...)
 *   unknown-order - siparis yok
 */
export type MilestoneResult =
  | {
      readonly outcome: 'advanced';
      readonly from: OrderStatus;
      readonly to: OrderStatus;
    }
  | { readonly outcome: 'not-yet'; readonly status: OrderStatus }
  | { readonly outcome: 'stale'; readonly status: OrderStatus; readonly field: StaleField }
  | { readonly outcome: 'duplicate'; readonly status: OrderStatus }
  | { readonly outcome: 'ignored'; readonly status: OrderStatus }
  | { readonly outcome: 'unknown-order' };

export type RecordCourierMilestone = (
  input: RecordCourierMilestoneInput,
) => Promise<MilestoneResult>;

export function createRecordCourierMilestone(
  deps: RecordCourierMilestoneDeps,
): RecordCourierMilestone {
  return async ({ orderId, milestone, occurredAt }) => {
    let order = await deps.repository.findById(orderId);
    for (let attempt = 1; ; attempt += 1) {
      if (order === null) {
        return { outcome: 'unknown-order' };
      }
      const decision = decideMilestone(order, milestone);
      if (decision.kind !== 'APPLY') {
        return resultOf(decision, order);
      }
      const at = milestoneTime(order, occurredAt, deps.clock.date());
      const write = await tryWriteTransition(
        deps.repository,
        order,
        advanceOrder(order, decision.steps, at),
      );
      if (write.written) {
        return { outcome: 'advanced', from: order.status, to: write.order.status };
      }
      if (attempt >= deps.writeAttempts) {
        throw write.error;
      }
      order = write.latest;
    }
  };
}

function resultOf(
  decision: Exclude<MilestoneDecision, { kind: 'APPLY' }>,
  order: Order,
): MilestoneResult {
  switch (decision.kind) {
    case 'NOT_YET':
      return { outcome: 'not-yet', status: order.status };
    case 'STALE':
      return { outcome: 'stale', status: order.status, field: decision.field };
    case 'DUPLICATE':
      return { outcome: 'duplicate', status: order.status };
    case 'IGNORED':
      return { outcome: 'ignored', status: order.status };
  }
}
