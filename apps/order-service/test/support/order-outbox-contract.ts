/**
 * Outbox SOZLESME testi (T7.3, ADR-04): ayni senaryolar bellekte (unit) ve
 * gercek Mongo'da (integration, gercek transaction) kosar.
 *
 * Mongo'da outbox koleksiyonu dosya boyunca paylasilir: her test once
 * bekleyenleri bosaltir (drain), boylece yalnizca kendi olaylarini gorur.
 */

import { AppError, ERROR_CODES, fixedClock, ORDER_STATUS } from '@getir/core';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  orderCreatedEvents,
  refundRequestedEvent,
  statusChangedEvents,
} from '../../src/domain/order-events.js';
import type { OrderEvent } from '../../src/domain/order-events.js';
import type { OrderOutbox } from '../../src/domain/order-outbox.js';
import type { OrderRepository } from '../../src/domain/order-repository.js';
import { createDraftOrder, transitionOrder } from '../../src/domain/order.js';
import type { Order } from '../../src/domain/order.js';
import { sampleDraftInput } from './order-builders.js';
import { START_MS } from './order-store-fixtures.js';

export interface OutboxPorts {
  readonly repository: OrderRepository;
  readonly outbox: OrderOutbox;
}

const DRAIN_LIMIT = 10_000;

export function describeOrderOutboxContract(name: string, getPorts: () => OutboxPorts): void {
  describe(`OrderOutbox sozlesmesi: ${name}`, () => {
    let ports: OutboxPorts;
    let userCounter = 0;

    beforeEach(async () => {
      ports = getPorts();
      const leftover = await ports.outbox.pending(DRAIN_LIMIT);
      await ports.outbox.markPublished(
        leftover.map((event) => event.eventId),
        new Date(START_MS),
      );
    });

    const draftAt = (epochMs: number): Order => {
      userCounter += 1;
      return createDraftOrder(
        sampleDraftInput({ userId: `usr_outbox-${name}-${userCounter}` }),
        fixedClock(epochMs),
      );
    };

    const ids = (events: readonly OrderEvent[]) => events.map((event) => event.eventId);

    it('insert: siparis ve olayi birlikte yazilir; olay alan kaybi olmadan okunur', async () => {
      const draft = draftAt(START_MS);
      const events = orderCreatedEvents(draft);

      await ports.repository.insert(draft, events);

      await expect(ports.outbox.pending(10)).resolves.toEqual(events);
    });

    it('update: gecis olaylari siparisle birlikte yazilir', async () => {
      const draft = draftAt(START_MS);
      await ports.repository.insert(draft, []);
      const checked = transitionOrder(draft, ORDER_STATUS.RISK_CHECK, fixedClock(START_MS + 1));
      const events = statusChangedEvents(draft, checked);

      await ports.repository.update(checked, draft.version, events);

      await expect(ports.outbox.pending(10)).resolves.toEqual(events);
    });

    it('surum cakismasi: ne siparis ne olay yazilir (tek atomik yazim)', async () => {
      const draft = draftAt(START_MS);
      await ports.repository.insert(draft, []);
      const winner = transitionOrder(draft, ORDER_STATUS.CANCELLED, fixedClock(START_MS + 1));
      await ports.repository.update(winner, draft.version, []);
      const loser = transitionOrder(draft, ORDER_STATUS.RISK_CHECK, fixedClock(START_MS + 2));

      const failing = ports.repository.update(
        loser,
        draft.version,
        statusChangedEvents(draft, loser),
      );

      await expect(failing).rejects.toBeInstanceOf(AppError);
      await expect(failing).rejects.toMatchObject({ code: ERROR_CODES.CONFLICT });
      await expect(ports.outbox.pending(10)).resolves.toEqual([]);
    });

    it('GERI ALMA (update): siparis yazildi ama olay yazilamadi -> siparis de eski halinde', async () => {
      const draft = draftAt(START_MS);
      const created = orderCreatedEvents(draft);
      await ports.repository.insert(draft, created);
      const checked = transitionOrder(draft, ORDER_STATUS.RISK_CHECK, fixedClock(START_MS + 1));
      // Ayni olay kimligi ikinci kez: siparis yazimindan SONRA olay yazimi patlar.
      const clashing = statusChangedEvents(draft, checked).map((event) => ({
        ...event,
        eventId: created[0]?.eventId ?? '',
      }));

      await expect(ports.repository.update(checked, draft.version, clashing)).rejects.toMatchObject(
        { code: ERROR_CODES.CONFLICT },
      );
      await expect(ports.repository.findById(draft.id)).resolves.toEqual(draft);
      await expect(ports.outbox.pending(10)).resolves.toEqual(created);
    });

    it('GERI ALMA (insert): olay yazilamadi -> siparis hic yazilmaz', async () => {
      const first = draftAt(START_MS);
      const firstEvents = orderCreatedEvents(first);
      await ports.repository.insert(first, firstEvents);
      const second = draftAt(START_MS + 1);
      const clashing = orderCreatedEvents(second).map((event) => ({
        ...event,
        eventId: firstEvents[0]?.eventId ?? '',
      }));

      await expect(ports.repository.insert(second, clashing)).rejects.toMatchObject({
        code: ERROR_CODES.CONFLICT,
      });
      await expect(ports.repository.findById(second.id)).resolves.toBeNull();
      await expect(ports.outbox.pending(10)).resolves.toEqual(firstEvents);
    });

    it('ayni kimlikle ikinci insert: CONFLICT, ikinci olay yazilmaz', async () => {
      const draft = draftAt(START_MS);
      const first = orderCreatedEvents(draft);
      await ports.repository.insert(draft, first);

      await expect(ports.repository.insert(draft, orderCreatedEvents(draft))).rejects.toMatchObject(
        { code: ERROR_CODES.CONFLICT },
      );
      await expect(ports.outbox.pending(10)).resolves.toEqual(first);
    });

    it('pending: yayin sirasi (olus zamani, esitlikte surum) ve limit', async () => {
      const early = draftAt(START_MS);
      const late = draftAt(START_MS + 5_000);
      await ports.repository.insert(late, orderCreatedEvents(late));
      await ports.repository.insert(early, orderCreatedEvents(early));
      // Ayni anda iki gecis: surum sirasi belirler.
      const clock = fixedClock(START_MS + 1_000);
      const walked = transitionOrder(
        transitionOrder(early, ORDER_STATUS.RISK_CHECK, clock),
        ORDER_STATUS.REVIEW,
        clock,
      );
      const walkedEvents = statusChangedEvents(early, walked);
      await ports.repository.update(walked, early.version, [...walkedEvents].reverse());

      const pending = await ports.outbox.pending(10);

      expect(pending.map((event) => [event.orderId, event.version])).toEqual([
        [early.id, 1],
        [early.id, 2],
        [early.id, 3],
        [late.id, 1],
      ]);
      await expect(ports.outbox.pending(2)).resolves.toHaveLength(2);
    });

    it('markPublished: isaretlenen bir daha gelmez; bilinmeyen kimlik yok sayilir', async () => {
      const first = draftAt(START_MS);
      const second = draftAt(START_MS + 1);
      await ports.repository.insert(first, orderCreatedEvents(first));
      await ports.repository.insert(second, orderCreatedEvents(second));
      const [firstEvent, secondEvent] = await ports.outbox.pending(10);

      await ports.outbox.markPublished(
        [firstEvent?.eventId ?? '', 'evt_00000000000000000000000000000000'],
        new Date(START_MS + 10),
      );

      expect(ids(await ports.outbox.pending(10))).toEqual([secondEvent?.eventId]);
    });

    it('append: siparis degismeden olay yazilir (telafi komutu)', async () => {
      const draft = draftAt(START_MS);
      const command = refundRequestedEvent(
        draft,
        { reason: 'order_changed_during_payment', idempotencyKey: `refund-${draft.id}` },
        new Date(START_MS + 1),
      );

      await ports.outbox.append([command]);

      await expect(ports.outbox.pending(10)).resolves.toEqual([command]);
    });
  });
}
