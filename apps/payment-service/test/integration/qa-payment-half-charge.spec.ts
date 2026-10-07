/**
 * QA PQ3 (T15.2, payment geriye donuk): YARIM KALAN CEKIM. Kayit saglayicidan ONCE PENDING yazilir
 * (ayni anahtarla iki cekimi onler, README); saglayicinin KARARI ise kayda tek denemede yazilir.
 * Karar ile yazim arasi kesilirse ne olur?
 *
 *   a) Gec uygulanan yazim: Mongo karardan hemen sonra donar (mongo-kit dondurulabilen vekili;
 *      konteynere dokunulmaz), yazim islem suresinde duser, istemci SERVICE_UNAVAILABLE alir.
 *      Cozulunce yolda kalan yazim Mongo'ya ulasir: kayit SUCCEEDED, tekrar istek iyilesir.
 *   b) Kaybolan yazim (surec karar ile yazim arasinda olur ya da baglanti yazimi goturur; depo
 *      sarmalayicisi yazimi HIC uygulamaz): MEVCUT davranis belgelenir (BULGU #142).
 *   c) Ayni sinif, karardan ONCE: PENDING yazildi ama yazimin onayi kayboldu (ag ya da Mongo
 *      gecisi). Charge kendi kaydini "ayni anahtarla es zamanli kazanan" sanar, PENDING doner ve
 *      saglayiciya HIC gitmez; kayit yine kalici PENDING (BULGU #142).
 *
 * Mock saglayicida para hareketi yoktur; "banka onayladi" saglayici casusunun APPROVED kararidir.
 * Gercek saglayicida (b) para cekilmis ama kaydi PENDING kalmis bir odeme demektir.
 */

import { AppError, ERROR_CODES } from '@getir/core';
import { appErrorOf } from '@getir/service-kit/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { startFreezingProxy } from '../../../../packages/mongo-kit/test/support/freezing-proxy.js';
import type { FreezingProxy } from '../../../../packages/mongo-kit/test/support/freezing-proxy.js';
import type { Payment } from '../../src/domain/payment.js';
import type { PaymentRepository } from '../../src/domain/payment-repository.js';
import { cancelCommand } from '../support/cancel-command.js';
import { directUri, mongoEnv, startCluster, useMongo } from '../support/qa-payment-cluster.js';
import type { PaymentCluster } from '../support/qa-payment-cluster.js';
import { MAX_DELIVERIES } from '../support/qa-payment-model.js';
import {
  chargeRequest,
  moneyOf,
  newOrder,
  Payments,
  refundRequest,
  STATUS,
  TOKEN,
} from '../support/qa-payment-requests.js';
import type { Order } from '../support/qa-payment-requests.js';
import { refundCommand } from '../support/refund-command.js';

const mongo = useMongo();
const TEST_TIMEOUT_MS = 60_000;
/** Yolda kalan yazimin vekil cozulunce Mongo'ya ulasmasi icin bol butce (kosul beklenir). */
const LATE_WRITE_BUDGET_MS = 10_000;
const ONE_HOUR_MS = 60 * 60 * 1_000;

let cluster: PaymentCluster | undefined;
let proxy: FreezingProxy | undefined;
afterEach(async () => {
  // Once sifirlanir (kapanis duserse sonraki test eskiyi yeniden kapatmaz); cozme her durumda
  // (sart 1): donuk vekil acik baglantiyi tutmasin.
  const running = cluster;
  const frozen = proxy;
  cluster = undefined;
  proxy = undefined;
  frozen?.thaw();
  try {
    await running?.stop();
  } finally {
    await frozen?.close();
  }
});

/**
 * Siparisi `lose` kumesinde olan kaydin karar yazimi Mongo'ya HIC gitmez (surec karar ile yazim
 * arasinda oldu). `loseAfterInsert`: PENDING YAZILIR ama yazimin onayi kaybolur (hata doner).
 */
class LosingWrites implements PaymentRepository {
  readonly loseUpdate = new Set<string>();
  readonly loseAfterInsert = new Set<string>();

  constructor(private readonly inner: PaymentRepository) {}

  async insert(payment: Payment): Promise<void> {
    await this.inner.insert(payment);
    if (this.loseAfterInsert.has(payment.orderId)) throw lostAck();
  }

  update(payment: Payment, expectedVersion: number): Promise<void> {
    if (this.loseUpdate.has(payment.orderId)) return Promise.reject(died());
    return this.inner.update(payment, expectedVersion);
  }

  findByOrderId(orderId: string): Promise<Payment | null> {
    return this.inner.findByOrderId(orderId);
  }

  findByIdempotencyKey(idempotencyKey: string): Promise<Payment | null> {
    return this.inner.findByIdempotencyKey(idempotencyKey);
  }
}

function died(): AppError {
  return new AppError(ERROR_CODES.SERVICE_UNAVAILABLE, 'QA: surec yazimdan once oldu');
}

function lostAck(): AppError {
  return new AppError(ERROR_CODES.SERVICE_UNAVAILABLE, 'QA: yazildi ama onayi kayboldu');
}

function approve(target: PaymentCluster, copy: number, order: Order) {
  return target
    .copy(copy)
    .call(Payments.charge, chargeRequest(order, { kind: 'token', token: TOKEN.APPROVE }));
}

/** Takilan kayit: her yoldan bakildiginda ayni PENDING, saglayiciya yeniden gidilmez. */
async function expectStuckPending(target: PaymentCluster, order: Order, authorized: number) {
  for (const copy of [0, 1, 0]) {
    const replay = await approve(target, copy, order);
    expect(replay.error).toBeUndefined();
    expect(replay.response?.payment?.status).toBe(STATUS.PAYMENT_STATUS_PENDING);
  }
  const read = await target.copy(1).call(Payments.getPayment, { orderId: order.orderId });
  expect(read.response?.payment?.status).toBe(STATUS.PAYMENT_STATUS_PENDING);
  // Iptal komutu "cekim suruyor" sanar: hic onaylanmaz, hak bitince olu olay (PR 2 PQ4).
  const at = target.clock.date();
  for (let attempt = 1; attempt <= MAX_DELIVERIES; attempt += 1) {
    await expect(
      target.copy(attempt).deliver(cancelCommand(order.orderId, at), attempt),
    ).rejects.toMatchObject({ code: ERROR_CODES.REQUEST_IN_PROGRESS });
  }
  // Iade de yok: RPC iade edilemez der, komut olu olaya gider.
  const refund = await target.copy(0).call(Payments.refund, refundRequest(order));
  expect(appErrorOf(refund.error)?.code).toBe(ERROR_CODES.CONFLICT);
  expect(await target.copy(1).deliver(refundCommand(order.orderId, at))).toMatchObject({
    kind: 'rejected',
  });
  expect(target.provider.authorized).toBe(authorized);
  const document = await target.documentOf(order.orderId);
  expect(document).toMatchObject({ status: 'PENDING', method: 'CARD' });
  expect(moneyOf(document)).toMatchObject({ charged: 0, refunded: 0 });
}

describe('QA PQ3 yarim kalan cekim: saglayici karar verdi, karar kayda yazilamadi', () => {
  it(
    'a) Mongo karardan sonra donar: istemci SERVICE_UNAVAILABLE; cozulunce yazim ulasir, kayit SUCCEEDED',
    async () => {
      const { uri, host, port } = mongo();
      proxy = await startFreezingProxy({ host, port });
      const frozen = proxy;
      const direct = mongoEnv(uri);
      const viaProxy = mongoEnv(directUri(`mongodb://127.0.0.1:${proxy.port}`), direct.dbName);
      cluster = await startCluster({ copies: [viaProxy, direct], inspect: direct });
      const target = cluster;
      const order = newOrder();
      target.provider.afterAuthorize = () => {
        target.provider.afterAuthorize = undefined;
        frozen.freeze();
      };

      const charged = await approve(target, 0, order);

      expect(appErrorOf(charged.error)?.code).toBe(ERROR_CODES.SERVICE_UNAVAILABLE);
      expect(target.provider.authorized).toBe(1);
      // Donukken: kayit PENDING, ikinci kopyadan tekrar istek "suruyor" gorur, yeniden cekmez.
      expect((await approve(target, 1, order)).response?.payment?.status).toBe(
        STATUS.PAYMENT_STATUS_PENDING,
      );
      frozen.thaw();
      await vi.waitFor(
        async () => {
          expect((await target.documentOf(order.orderId)).status).toBe('SUCCEEDED');
        },
        { timeout: LATE_WRITE_BUDGET_MS, interval: 100 },
      );
      expect((await approve(target, 0, order)).response?.payment?.status).toBe(
        STATUS.PAYMENT_STATUS_SUCCEEDED,
      );
      expect(target.provider.authorized).toBe(1);
      expect(moneyOf(await target.documentOf(order.orderId))).toMatchObject({
        charged: 1,
        refunded: 0,
      });
    },
    TEST_TIMEOUT_MS,
  );

  // #142: duzeltmeyle TERSINE donecek ((i) karar yazimi gecici hatada yeniden denenir; kalici
  // cozum saglayici uzlasmasi #137 ile: kayit SUCCEEDED/FAILED olur, iptalde iade edilir).
  it(
    'b) MEVCUT davranis: karar yazimi kaybolur -> banka ONAYLADI ama kayit kalici PENDING; tekrar, iptal, iade, zaman iyilestirmez',
    async () => {
      const env = mongoEnv(mongo().uri);
      let losing: LosingWrites | undefined;
      cluster = await startCluster({
        copies: [env, env],
        inspect: env,
        wrap: (repository, copy) =>
          copy === 0 ? (losing = new LosingWrites(repository)) : repository,
      });
      const order = newOrder();
      losing?.loseUpdate.add(order.orderId);

      const charged = await approve(cluster, 0, order);

      expect(appErrorOf(charged.error)?.code).toBe(ERROR_CODES.SERVICE_UNAVAILABLE);
      expect(cluster.provider.authorized).toBe(1);
      // Surec yeniden acildi (yazim artik kaybolmuyor); kayit yine de iyilesmez.
      losing?.loseUpdate.clear();
      expect((await cluster.documentOf(order.orderId)).attempts).toEqual([]);
      await expectStuckPending(cluster, order, 1);
      cluster.clock.advance(ONE_HOUR_MS);
      await expectStuckPending(cluster, order, 1);
    },
    TEST_TIMEOUT_MS,
  );

  // #142: duzeltmeyle TERSINE donecek ((ii) insert hatasinda donen kayit bu istegin kendisiyse
  // akis saglayiciya devam eder).
  it(
    'c) MEVCUT davranis: PENDING yazildi, onayi kayboldu -> kendi kaydini kazanan sanip PENDING doner; saglayiciya hic gidilmez, kayit kalici PENDING',
    async () => {
      const env = mongoEnv(mongo().uri);
      let losing: LosingWrites | undefined;
      cluster = await startCluster({
        copies: [env, env],
        inspect: env,
        wrap: (repository, copy) =>
          copy === 0 ? (losing = new LosingWrites(repository)) : repository,
      });
      const order = newOrder();
      losing?.loseAfterInsert.add(order.orderId);

      const charged = await approve(cluster, 0, order);

      // Hata degil: insert hatasi "es zamanli ayni anahtar" yoluna duser ve KENDI kaydini doner.
      expect(charged.error).toBeUndefined();
      expect(charged.response?.payment?.status).toBe(STATUS.PAYMENT_STATUS_PENDING);
      losing?.loseAfterInsert.clear();
      await expectStuckPending(cluster, order, 0);
    },
    TEST_TIMEOUT_MS,
  );
});
