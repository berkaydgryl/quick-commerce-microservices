/**
 * QA kara kutu (T13.2 PR 2, goc 0001 kurye-sirasi), kullanicinin yolundan:
 * T13.1 doneminde birikmis kurye bekleyenler (kuyruk ani YOK) olan veritabaninda
 * yeni kod ACILIRKEN goc uygulanir; elle komut (dist/migrate.js) gercek surec.
 *
 * Backend'in goc testi runner'i dogrudan cagirir ve elle kurulmus belgelerle
 * up/down/yeniden up verisini sinar; burada:
 *   - veri gercek isciyle olusur (gercek courier, tek kurye), `migrate down`
 *     komutu alan oncesine dondurur; T13.1 iscisi bekleyeni her denemede
 *     yeniden yazdigi icin eski bekleyenin deneme ani yenisinden SONRA,
 *   - servis acilisi goci uygular (gunlukte bir kez, 3 siparis), komutun
 *     `status`u uygulandi der, `up` bos gecer,
 *   - gocten sonra bosalan kurye EN ESKI odeyene gider: deneme ani gelmemis
 *     olsa da (goc olmasa bekleyen sorgusu onu hic bulmaz, kurye yeniye gider).
 */

import { fixedClock, ID_PREFIX, newId, ORDER_STATUS } from '@getir/core';
import type { LogLine } from '@getir/core/testing';
import { MongoDBContainer } from '@testcontainers/mongodb';
import type { StartedMongoDBContainer } from '@testcontainers/mongodb';
import { MongoClient } from 'mongodb';
import type { Document } from 'mongodb';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { COLLECTIONS } from '../../src/infrastructure/mongo/documents.js';
import { placeCouriers, QA_NOW_MS } from '../support/qa-courier-world.js';
import {
  assertOrderBuilt,
  courierOnMongo,
  logLine,
  orderOnMongo,
  runOrderMigrate,
} from '../support/qa-mongo-world.js';
import type { Cleanups } from '../support/qa-mongo-world.js';

const MONGO_IMAGE = 'mongo:7';
const QUEUE_INDEX = 'status_courierQueuedAt_id';
const MIGRATION = '1 kurye-sirasi';
/** Sonraki goc (#101): `down` en son gocu geri aldigi icin once o geri alinir. */
const LATER_MIGRATION = '2 gecmis-gorunurlugu';
const SECOND = 1_000;

let container: StartedMongoDBContainer;
let raw: MongoClient;
const cleanups: Cleanups = [];

const uri = (): string => `${container.getConnectionString()}/?directConnection=true`;
const at = (seconds: number): Date => new Date(QA_NOW_MS + seconds * SECOND);

beforeAll(async () => {
  assertOrderBuilt();
  container = await new MongoDBContainer(MONGO_IMAGE).start();
  raw = await MongoClient.connect(uri());
});

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) {
    await cleanup();
  }
});

afterAll(async () => {
  await raw?.close();
  await container?.stop();
});

describe('QA goc 0001 kurye-sirasi: acilista ve komutla, gercek isci + courier', () => {
  it('T13.1 verisi: acilis goci uygular (odeme ani), komut durumu dogru; bosalan kurye en eski odeyene gider', async () => {
    const tag = newId(ID_PREFIX.EVENT).slice(-8);
    const mongo = { uri: uri(), dbName: `qa_order_goc_${tag}` };
    const orders = raw.db(mongo.dbName).collection<Document>(COLLECTIONS.ORDERS);
    const clock = fixedClock(QA_NOW_MS);
    const placed = placeCouriers(1);
    const courier = await courierOnMongo({
      uri: uri(),
      dbName: `qa_courier_${tag}`,
      placed,
      clock,
      cleanups,
    });

    // Eski surum calisiyor: tek kurye ilk sipariste, iki bekleyen, bir yeni odeme.
    const old = await orderOnMongo({
      ...mongo,
      courierAddress: courier.service.address,
      clock,
      cleanups,
    });
    const holder = await old.paid();
    await old.tour();
    clock.advance(SECOND);
    const older = await old.paid();
    await old.tour();
    clock.advance(SECOND);
    const newer = await old.paid();
    await old.tour();
    clock.advance(SECOND);
    const fresh = await old.paid();
    old.close();

    // Alan oncesine don (komutla) ve T13.1 iscisinin izini birak: eski bekleyen
    // sonradan yeniden denenmis, deneme ani yenisinden gec. `down` en son gocu
    // geri alir: once 0002 (#101), sonra 0001.
    const downLater = await runOrderMigrate('down', mongo);
    const down = await runOrderMigrate('down', mongo);
    await orders.updateOne({ _id: older.id } as Document, { $set: { courierRetryAt: at(100) } });
    const pending = await runOrderMigrate('status', mongo);

    expect(downLater.code).toBe(0);
    expect(logLine(downLater.output, 'goc down bitti')?.['reverted']).toBe(LATER_MIGRATION);
    expect(down.code).toBe(0);
    expect(logLine(down.output, 'goc down bitti')?.['reverted']).toBe(MIGRATION);
    expect(logLine(pending.output, 'goc durumu')).toMatchObject({
      applied: [],
      pending: [MIGRATION, LATER_MIGRATION],
    });
    expect(await orders.countDocuments({ courierQueuedAt: { $exists: true } })).toBe(0);
    expect((await orders.indexes()).map((index) => index.name)).not.toContain(QUEUE_INDEX);

    // Yeni surum acilir: goc uygulanir.
    const startupLines: LogLine[] = [];
    const side = await orderOnMongo({
      ...mongo,
      courierAddress: courier.service.address,
      clock,
      lines: startupLines,
      cleanups,
    });
    const queued = await orders.find({}, { projection: { courierQueuedAt: 1 } }).toArray();
    const queuedAt = Object.fromEntries(
      queued.map((row) => [String(row['_id']), row['courierQueuedAt']]),
    );
    const status = await runOrderMigrate('status', mongo);
    const up = await runOrderMigrate('up', mongo);

    expect(startupLines.filter((line) => line.message === 'goc uygulandi')).toHaveLength(2);
    expect(
      startupLines.find((line) => line.message === 'kurye kuyrugu goc edildi')?.fields['queued'],
    ).toBe(3);
    expect(queuedAt).toEqual({
      [holder.id]: undefined,
      [older.id]: at(1),
      [newer.id]: at(2),
      [fresh.id]: at(3),
    });
    expect((await orders.indexes()).map((index) => index.name)).toContain(QUEUE_INDEX);
    expect(status.code).toBe(0);
    expect(logLine(status.output, 'goc durumu')?.['pending']).toEqual([]);
    expect(logLine(status.output, 'goc durumu')?.['applied']).toEqual([
      expect.stringMatching(/^1 kurye-sirasi /),
      expect.stringMatching(/^2 gecmis-gorunurlugu /),
    ]);
    expect(up.code).toBe(0);
    expect(logLine(up.output, 'goc up bitti')?.['applied']).toEqual([]);

    // t+50: yeninin deneme ani gecti, eskininki (t+100) gelmedi; kurye bosalir.
    clock.advance(47 * SECOND);
    expect((await courier.service.release(holder.id))?.released).toBe(true);
    await side.tour();
    const [olderNow, newerNow, freshNow] = await Promise.all(
      [older.id, newer.id, fresh.id].map((id) => side.order(id)),
    );

    expect(olderNow?.courier?.courierId).toBe(placed[0]?.id);
    expect(newerNow?.courier).toBeUndefined();
    expect(freshNow).toMatchObject({ status: ORDER_STATUS.PREPARING });
    expect(freshNow?.courier).toBeUndefined();
  });
});
