/**
 * Outbox yayin turu (T7.3): sira, isaretleme ve hata davranisi. Bellek deposu
 * ve bellek ici yayinci; ag yok.
 */

import { fixedClock, silentLogger } from '@getir/core';
import { InMemoryEventPublisher } from '@getir/event-bus';
import type { EventEnvelope, EventPublisher } from '@getir/event-bus';
import { beforeEach, describe, expect, it } from 'vitest';

import { createRelayOutbox } from '../../src/application/relay-outbox.js';
import { InMemoryOrderStore } from '../../src/infrastructure/memory/in-memory-order-store.js';
import { insertAwaitingPayment, insertDraft } from '../support/order-builders.js';

const T0 = 1_760_000_000_000;
const clock = fixedClock(T0);

let store: InMemoryOrderStore;
let publisher: InMemoryEventPublisher;

beforeEach(() => {
  store = new InMemoryOrderStore();
  publisher = new InMemoryEventPublisher();
});

const relayWith = (target: EventPublisher, batchSize = 100) =>
  createRelayOutbox({ outbox: store, publisher: target, clock, batchSize });

/** N'inci yayinda hata veren yayinci; oncekileri kaydeder. */
function failingAt(failIndex: number): { publisher: EventPublisher; sent: EventEnvelope[] } {
  const sent: EventEnvelope[] = [];
  return {
    sent,
    publisher: {
      publish: (envelope) => {
        if (sent.length === failIndex) {
          return Promise.reject(new Error('redis kapali'));
        }
        sent.push(envelope);
        return Promise.resolve();
      },
    },
  };
}

describe('relayOutbox', () => {
  it('bekleyenleri sirayla zarf olarak yayinlar ve isaretler', async () => {
    const order = await insertAwaitingPayment(store, clock);

    const count = await relayWith(publisher)(silentLogger);

    expect(count).toBe(4);
    expect(publisher.published.map((envelope) => [envelope.topic, envelope.payload['to']])).toEqual(
      [
        ['order.created', undefined],
        ['order.status_changed', 'RISK_CHECK'],
        ['order.status_changed', 'RESERVED'],
        ['order.status_changed', 'AWAITING_PAYMENT'],
      ],
    );
    expect(publisher.published[0]).toMatchObject({
      partitionKey: order.id,
      occurredAt: new Date(T0).toISOString(),
    });
    await expect(store.pending(10)).resolves.toEqual([]);
  });

  it('ikinci tur bos: yayinlanan tekrar gitmez', async () => {
    await insertDraft(store, clock);
    const relay = relayWith(publisher);

    await relay(silentLogger);
    const second = await relay(silentLogger);

    expect(second).toBe(0);
    expect(publisher.published).toHaveLength(1);
  });

  it('ilk hatada tur DURUR: oncekiler isaretlenir, sonrakiler sira bozulmadan bekler', async () => {
    await insertAwaitingPayment(store, clock);
    const { publisher: flaky, sent } = failingAt(2);

    const count = await relayWith(flaky)(silentLogger);

    expect(count).toBe(2);
    const remaining = await store.pending(10);
    expect(remaining.map((event) => event.version)).toEqual([3, 4]);
    // Sonraki tur kaldigi yerden, sirayla devam eder.
    await relayWith(publisher)(silentLogger);
    expect(
      [...sent, ...publisher.published].map((envelope) => envelope.payload['version']),
    ).toEqual([1, 2, 3, 4]);
  });

  it('parti boyu sinirlidir', async () => {
    await insertAwaitingPayment(store, clock);

    await expect(relayWith(publisher, 3)(silentLogger)).resolves.toBe(3);
    await expect(store.pending(10)).resolves.toHaveLength(1);
  });
});
