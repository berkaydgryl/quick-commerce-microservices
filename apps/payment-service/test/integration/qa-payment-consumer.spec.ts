/**
 * QA PQ4 (T15.2, payment geriye donuk PR 2): olay tuketicisi gercek Redis ve Mongo'da
 * (Testcontainers), main.ts'in kurulumuyla (RedisStreamsConsumer + subscribePaymentEvents).
 * Mevcut uctan uca test (refund-requested-consumer) TEK tuketiciyle tek komut sinar; burada:
 *
 *   a) iki kopya ayni grupta, yinelenen komut seli (her siparise 2 iade + 2 iptal komutu, farkli
 *      olay kimligiyle): her sipariste TEK iade, olu olay yok.
 *   b) kopya isleyicinin ortasinda takilir (etkiden sonra ya da once, onay gitmeden): diger kopya
 *      takilma suresinden sonra kaydi devralir; etki yine TEK.
 *   c) yarim kalan cekim (#142): PENDING kart odemenin iptal komutu her teslimde "cekim suruyor"
 *      der; hak bitince (maxDeliveries) olu olay, ERROR ve dead sayaci. Para kaydi degismez.
 *   d) bozuk govde: tekrar denenmez, hemen olu olay (rejected).
 *
 * Bekleme kosulladir (grup bosaldi mi, olu olay geldi mi); sabit uyku yok.
 */

import { setTimeout as delay } from 'node:timers/promises';

import { ID_PREFIX, newId, systemClock } from '@getir/core';
import { recordingLogger } from '@getir/core/testing';
import type { LogLine } from '@getir/core/testing';
import {
  DEAD_LETTER_FIELD,
  DEAD_LETTER_REASON,
  DEFAULT_DELIVERY_SETTINGS,
  RedisStreamsConsumer,
  RedisStreamsPublisher,
} from '@getir/event-bus';
import type { EventEnvelope, EventHandler, EventSubscriber } from '@getir/event-bus';
import type { MongoConnection } from '@getir/mongo-kit';
import { metricsRegistry } from '@getir/observability';
import { connectRedis } from '@getir/redis-kit';
import type { RedisConnection } from '@getir/redis-kit';
import { MongoDBContainer } from '@testcontainers/mongodb';
import type { StartedMongoDBContainer } from '@testcontainers/mongodb';
import { RedisContainer } from '@testcontainers/redis';
import type { StartedRedisContainer } from '@testcontainers/redis';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { subscribePaymentEvents } from '../../src/bootstrap.js';
import { EVENT_CONSUMER_GROUP } from '../../src/config/constants.js';
import { startPayment } from '../../src/domain/charge.js';
import { PAYMENT_METHOD } from '../../src/domain/payment.js';
import type { PaymentMongoStore } from '../../src/infrastructure/mongo/payment-mongo-store.js';
import { cancelCommand } from '../support/cancel-command.js';
import { chargeOrder } from '../support/charge-order.js';
import { openPaymentStore } from '../support/mongo-payment-service.js';
import { startContainer } from '../support/qa-payment-cluster.js';
import { gate } from '../support/qa-provider-spy.js';
import { refundCommand } from '../support/refund-command.js';

const MONGO_IMAGE = 'mongo:7';
const REDIS_IMAGE = 'redis:7-alpine';
const CONTAINER_START_TIMEOUT_MS = 120_000;
const TEST_TIMEOUT_MS = 60_000;
/**
 * Teslim ayarlari kisa (gercek: blok 2 sn, takilma 30 sn); hak sayisi uretimdeki. Parti 1: bir
 * kopya butun akisi tek okumada alamaz, iki kopya ayni siparisin komutlarini ayni anda isler.
 */
const FAST_DELIVERY = { blockMs: 50, claimIdleMs: 200, retryDelayMs: 20, batchSize: 1 };
const ORDERS = 10;
const WAIT_BUDGET_MS = 20_000;
/** @getir/event-bus consumer-metrics.ts: sonuclanan olay sayaci (outcome dead). */
const EVENTS_METRIC = 'event_consumer_events_total';

let mongoContainer: StartedMongoDBContainer;
let redisContainer: StartedRedisContainer;
const stores: { store: PaymentMongoStore; connection: MongoConnection }[] = [];
let admin: RedisConnection;
const consumers: RedisStreamsConsumer[] = [];
let streams = 0;

beforeAll(async () => {
  // Sirayla: Docker bellek siniri altinda iki konteyner ayni anda acilmasin.
  mongoContainer = await startContainer('Mongo', () => new MongoDBContainer(MONGO_IMAGE).start());
  redisContainer = await startContainer('Redis', () => new RedisContainer(REDIS_IMAGE).start());
  const target = {
    uri: `${mongoContainer.getConnectionString()}?directConnection=true`,
    dbName: 'qa_payment_consumer',
  };
  // Iki kopya: her biri kendi Mongo baglantisiyla (iki payment sureci gibi).
  stores.push(await openPaymentStore(target), await openPaymentStore(target));
  admin = await connectRedis({ url: redisContainer.getConnectionUrl(), name: 'qa-consumer-admin' });
}, CONTAINER_START_TIMEOUT_MS);

afterEach(async () => {
  await Promise.allSettled(consumers.splice(0).map((consumer) => consumer.stop()));
});

afterAll(async () => {
  await admin?.close();
  await Promise.allSettled(stores.map(({ connection }) => connection.close()));
  await Promise.allSettled([mongoContainer?.stop(), redisContainer?.stop()]);
});

interface Streams {
  readonly streamKey: string;
  readonly deadLetterKey: string;
}

function freshStreams(): Streams {
  streams += 1;
  return {
    streamKey: `stream:qa-payment-${streams}`,
    deadLetterKey: `stream:qa-payment-${streams}:dead`,
  };
}

function store(copy: number): PaymentMongoStore {
  const opened = stores[copy % stores.length];
  if (opened === undefined) throw new Error('depo acilmadi');
  return opened.store;
}

/**
 * main.ts'teki tuketici (kopya basina tekil ad); `wrap` isleyiciyi sarar (b: takilma).
 * Kayitlar baslatmadan once yapilir (subscribe sozlesmesi).
 */
async function startCopy(
  copy: number,
  target: Streams,
  options: {
    logger?: ReturnType<typeof recordingLogger>;
    wrap?: (inner: EventHandler) => EventHandler;
  } = {},
): Promise<void> {
  const consumer = new RedisStreamsConsumer({
    connect: () =>
      connectRedis({ url: redisContainer.getConnectionUrl(), name: `qa-payment-${copy}` }),
    consumerName: `qa-payment-${copy}`,
    streamKey: target.streamKey,
    deadLetterKey: target.deadLetterKey,
    delivery: FAST_DELIVERY,
    ...(options.logger === undefined ? {} : { logger: options.logger }),
  });
  const wrap = options.wrap ?? ((inner: EventHandler) => inner);
  const subscriber: EventSubscriber = {
    subscribe: (topic, group, handler) => consumer.subscribe(topic, group, wrap(handler)),
  };
  subscribePaymentEvents(subscriber, { repository: store(copy) });
  consumers.push(consumer);
  await consumer.start();
}

function publish(target: Streams, envelope: EventEnvelope): Promise<void> {
  return new RedisStreamsPublisher(admin.redis, { streamKey: target.streamKey }).publish(envelope);
}

/** Kosul beklemesi (sabit uyku degil): saglanana ya da butce bitene kadar yoklar. */
async function waitFor(what: string, check: () => Promise<boolean>): Promise<void> {
  const deadline = Date.now() + WAIT_BUDGET_MS;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error(`${what}: ${WAIT_BUDGET_MS} ms icinde olmadi`);
    await delay(20);
  }
}

const groupsInfoSchema = z.array(z.array(z.union([z.string(), z.number(), z.null()])));

/** Payment grubu akistaki her kaydi okudu ve onayladi mi (lag ve pending sifir)? */
async function drained(target: Streams): Promise<boolean> {
  const groups = groupsInfoSchema.parse(await admin.redis.xinfo('GROUPS', target.streamKey));
  return groups.some((flat) => {
    const info = new Map<unknown, unknown>();
    for (let index = 0; index + 1 < flat.length; index += 2) info.set(flat[index], flat[index + 1]);
    return (
      info.get('name') === EVENT_CONSUMER_GROUP &&
      info.get('pending') === 0 &&
      info.get('lag') === 0
    );
  });
}

async function chargedOrder(): Promise<string> {
  const orderId = newId(ID_PREFIX.ORDER);
  await chargeOrder({
    repository: store(0),
    clock: systemClock,
    orderId,
    cardToken: 'tok_test_4242',
  });
  return orderId;
}

async function refundsOf(orderId: string): Promise<number> {
  const payment = await store(1).findByOrderId(orderId);
  if (payment === null) throw new Error(`odeme yok: ${orderId}`);
  return payment.attempts.filter((attempt) => attempt.kind === 'REFUND').length;
}

async function deadEntries(target: Streams): Promise<Map<string, string>[]> {
  const entries = await admin.redis.xrange(target.deadLetterKey, '-', '+');
  return entries.map(([, fields]) => {
    const values = new Map<string, string>();
    for (let index = 0; index + 1 < fields.length; index += 2) {
      values.set(fields[index] ?? '', fields[index + 1] ?? '');
    }
    return values;
  });
}

async function deadCount(): Promise<number> {
  const metric = await metricsRegistry.getSingleMetric(EVENTS_METRIC)?.get();
  return (metric?.values ?? [])
    .filter(
      (value) => value.labels.outcome === 'dead' && value.labels.group === EVENT_CONSUMER_GROUP,
    )
    .reduce((sum, value) => sum + value.value, 0);
}

describe('QA PQ4 payment olay tuketicisi (gercek Redis + Mongo, iki kopya)', () => {
  it(
    `a) iki kopya ayni grupta, ${ORDERS} siparise yinelenen iade ve iptal komutlari: her sipariste TEK iade`,
    async () => {
      const target = freshStreams();
      const orders = await Promise.all(Array.from({ length: ORDERS }, () => chargedOrder()));
      const at = systemClock.date();
      // Iki kopya ONCE dinlemeye baslar; komutlar sonra gelir (ikisi de bekliyor, parti 1).
      await Promise.all([startCopy(0, target), startCopy(1, target)]);
      for (const orderId of orders) {
        for (const envelope of [
          refundCommand(orderId, at),
          cancelCommand(orderId, at),
          refundCommand(orderId, at),
          cancelCommand(orderId, at),
        ]) {
          await publish(target, envelope);
        }
      }

      await waitFor('grup bosalmadi', () => drained(target));

      for (const orderId of orders) {
        expect({ orderId, refunds: await refundsOf(orderId) }).toEqual({ orderId, refunds: 1 });
        expect((await store(0).findByOrderId(orderId))?.status).toBe('REFUNDED');
      }
      expect(await admin.redis.xlen(target.deadLetterKey)).toBe(0);
    },
    TEST_TIMEOUT_MS,
  );

  it.each([
    ['etkiden SONRA', 'after'],
    ['etkiden ONCE', 'before'],
  ] as const)(
    'b) kopya isleyicide %s takilir, onay gitmez: diger kopya devralir, etki TEK',
    async (_label, when) => {
      const target = freshStreams();
      const orderId = await chargedOrder();
      const stuck = gate();
      const arrived = gate();
      let first = true;
      // Kopya 0'in ILK teslimi takilir (surec oldu ya da dondu gibi): kayit onaylanmaz.
      const wrap =
        (inner: EventHandler): EventHandler =>
        async (envelope, delivery) => {
          if (!first) return inner(envelope, delivery);
          first = false;
          if (when === 'before') {
            arrived.open();
            await stuck.opened;
            return inner(envelope, delivery);
          }
          const outcome = await inner(envelope, delivery);
          arrived.open();
          await stuck.opened;
          return outcome;
        };
      await startCopy(0, target, { wrap });
      await publish(target, refundCommand(orderId, systemClock.date()));
      await arrived.opened;

      try {
        await startCopy(1, target);
        await waitFor('ikinci kopya devralmadi', async () => (await refundsOf(orderId)) === 1);
        await waitFor('grup bosalmadi', () => drained(target));
      } finally {
        // Takilan kopya serbest: gec gelen ikinci uygulama "zaten iade edildi" gorur.
        stuck.open();
      }
      await Promise.all(consumers.splice(0).map((consumer) => consumer.stop()));

      expect(await refundsOf(orderId)).toBe(1);
      expect(await admin.redis.xlen(target.deadLetterKey)).toBe(0);
    },
    TEST_TIMEOUT_MS,
  );

  // #142: duzeltmeyle TERSINE donecek (takili PENDING uzlasmayla sonuclanir, iptal iade ya da
  // kapatma ile onaylanir).
  it(
    'c) MEVCUT davranis: PENDING kart odemesinin iptal komutu hak bitince olu olay; ERROR ve dead sayaci, kayit degismez',
    async () => {
      const target = freshStreams();
      const lines: LogLine[] = [];
      const orderId = newId(ID_PREFIX.ORDER);
      // Yarim kalan cekim (#142, PQ3): PENDING kart kaydi, karar hic yazilmadi.
      await store(0).insert(
        startPayment(
          {
            orderId,
            userId: newId(ID_PREFIX.USER),
            amount: { amountMinor: 12_990, currency: 'TRY' },
            method: PAYMENT_METHOD.CARD,
            idempotencyKey: `qa-yarim-${orderId}`,
          },
          systemClock,
        ),
      );
      const deadBefore = await deadCount();

      await startCopy(0, target, { logger: recordingLogger(lines) });
      await publish(target, cancelCommand(orderId, systemClock.date()));
      await waitFor(
        'olu olay gelmedi',
        async () => (await admin.redis.xlen(target.deadLetterKey)) === 1,
      );
      // ERROR satiri olu olay yazildiktan ve kayit onaylandiktan SONRA: grup bosalinca bakilir.
      await waitFor('grup bosalmadi', () => drained(target));

      const [dead] = await deadEntries(target);
      expect(dead?.get(DEAD_LETTER_FIELD.REASON)).toBe(DEAD_LETTER_REASON.EXHAUSTED);
      expect(Number(dead?.get(DEAD_LETTER_FIELD.ATTEMPTS))).toBe(
        DEFAULT_DELIVERY_SETTINGS.maxDeliveries,
      );
      expect(dead?.get(DEAD_LETTER_FIELD.ERROR)).toContain('Kart cekimi hala isleniyor');
      expect(lines.filter((line) => line.level === 'error')).toHaveLength(1);
      expect((await deadCount()) - deadBefore).toBe(1);
      const payment = await store(1).findByOrderId(orderId);
      expect(payment).toMatchObject({ status: 'PENDING', attempts: [] });
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'd) bozuk govde: tekrar denenmez, hemen olu olay (rejected, 1 teslim)',
    async () => {
      const target = freshStreams();
      await startCopy(0, target);
      // Govde sozlesmeye uymuyor (orderId metin degil): isleyici reddeder.
      await publish(
        target,
        cancelCommand(newId(ID_PREFIX.ORDER), systemClock.date(), { orderId: 42 }),
      );

      await waitFor(
        'olu olay gelmedi',
        async () => (await admin.redis.xlen(target.deadLetterKey)) === 1,
      );

      const [dead] = await deadEntries(target);
      expect(dead?.get(DEAD_LETTER_FIELD.REASON)).toBe(DEAD_LETTER_REASON.REJECTED);
      expect(dead?.get(DEAD_LETTER_FIELD.ATTEMPTS)).toBe('1');
      await waitFor('grup bosalmadi', () => drained(target));
    },
    TEST_TIMEOUT_MS,
  );
});
