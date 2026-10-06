/**
 * QA kara kutu (T15.2 geriye donuk tur, inventory PR 1): stok KORUNUMU, gercek Redis ve Mongo.
 *
 *   IQ1 Karisik eszamanli yuk: ayni Redis ve Mongo'ya bagli IKI inventory sunucusu (uretimdeki
 *       acilis openStockSource), paylasilan sahte saat, tohumlu 500 islem: rezervasyon, birakma,
 *       onay, uzatma, kisaltma ve supurme ayni dalgalarda. Degismezler:
 *         HER DALGA SONUNDA
 *         I1 SKU basina: Redis sayaci + aktif rezervasyon adedi == Mongo onHand
 *         I2 her sayac VAR ve eksiye dusmez
 *         I3 kismi yok: yeni rezervasyon istenen BUTUN kalemleri tutar; reddedilen iz birakmaz
 *         I7 B22: kullanici basina en cok bir aktif rezervasyon
 *         I8 beklenmeyen hata yok: reddin kodu yalniz STOCK_INSUFFICIENT ya da RESERVATION_ACTIVE,
 *            diger islemlerde INTERNAL yok, sunucu gunlugunde error satiri yok (supurme dahil)
 *         I9 indekste yalnizca aktif rezervasyon: yetim ya da sonuclanmis uye yok
 *         SONDA
 *         I4 her siparisin defterde en cok bir sonuc turu var (birakma | onay | sure dolumu)
 *         I5 B24 defter denetimi fark gostermez
 *         I6 onHand'in toplam dususu == defterdeki onay adedi; indeks bos, sayac == onHand
 *   IQ2 Ters sirali cok SKU yarisi: x ve y birer adet; her turda 50 {x,y} + 50 {y,x} istek ayni
 *       anda; iki sira da iki sunucuya dagitilir. Turda TAM bir kazanan, iki kalemi birlikte;
 *       kaybedenler STOCK_INSUFFICIENT alir ve iz birakmaz. 20 tur.
 *
 * Beklenen sonuc modeli YOK: degismezler depodan okunur. Tohum islem KARISIMINI ve parametreleri
 * sabitler; eszamanli isteklerin kazanani zamanlamaya baglidir, kosu birebir tekrar etmez.
 *
 * Cagiran (order) onayin CONFLICT'ini (P3) ve belirsiz sonucu kendi is akisinda SONRA yeniden dener;
 * burada ayni dalgada tamamlanir (Extend NOT_IDEMPOTENT oldugu icin tekrarlanmaz). Yarida kalan ara
 * durum (ADR-18: Redis onayli, Mongo bekleyen) dalga ortasinda okunmaz; onu IQ3 ayrica sinar.
 * Redis TTL'leri gercek zamanlidir (kisaltma 300 sn): kosu suresinden uzun, sahte saatle ayrismaz.
 */

import { ERROR_CODES, fixedClock } from '@getir/core';
import { recordingLogger } from '@getir/core/testing';
import type { LogLine } from '@getir/core/testing';
import { inventoryV1 } from '@getir/proto';
import type { RedisConnection } from '@getir/redis-kit';
import {
  connectRedis,
  reservationIndexKey,
  reservationKey,
  stockAvailKey,
  userReservationKey,
} from '@getir/redis-kit';
import { appErrorOf, startTestGrpcServer } from '@getir/service-kit/testing';
import type { TestGrpcServer } from '@getir/service-kit/testing';
import { MongoDBContainer } from '@testcontainers/mongodb';
import type { StartedMongoDBContainer } from '@testcontainers/mongodb';
import { RedisContainer } from '@testcontainers/redis';
import type { StartedRedisContainer } from '@testcontainers/redis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createCheckLedger } from '../../src/application/check-ledger.js';
import { createSeedStock } from '../../src/application/seed-stock.js';
import type { SweepExpired } from '../../src/application/sweep-expired.js';
import { buildInventoryService, buildSweepExpired } from '../../src/bootstrap.js';
import type { StockStoresEnv } from '../../src/config/env.js';
import type { StockLevel } from '../../src/domain/stock.js';
import { LEDGER_KINDS } from '../../src/domain/stock-ledger.js';
import { COLLECTIONS } from '../../src/infrastructure/mongo/documents.js';
import type {
  StockDocument,
  StockLedgerDocument,
} from '../../src/infrastructure/mongo/documents.js';
import { MongoStockSeedWriter } from '../../src/infrastructure/mongo/mongo-stock-seed-writer.js';
import type { StockSource } from '../../src/infrastructure/stock-source.js';
import { openStockSource } from '../../src/infrastructure/stock-source.js';
import type { StockStores } from '../../src/infrastructure/stock-stores.js';
import { openStockStores } from '../../src/infrastructure/stock-stores.js';
import { orderId, userId } from '../support/reservation-store-contract.js';

const MONGO_IMAGE = 'mongo:7';
const REDIS_IMAGE = 'redis:7-alpine';
const DB_NAME = 'qa_inventory_korunum';
const CONSERVE_MARKET = 'mkt_qa-korunum';
const RACE_MARKET = 'mkt_qa-ters-sira';
/** Iki kit SKU (cekisme, yetersizlik) ve bol SKU'lar (gercek hareket: onay, birakma, sure dolumu). */
const CONSERVE_LEVELS: readonly StockLevel[] = [
  { marketId: CONSERVE_MARKET, sku: 'QA-A', onHand: 1 },
  { marketId: CONSERVE_MARKET, sku: 'QA-B', onHand: 2 },
  { marketId: CONSERVE_MARKET, sku: 'QA-C', onHand: 5 },
  { marketId: CONSERVE_MARKET, sku: 'QA-D', onHand: 15 },
  { marketId: CONSERVE_MARKET, sku: 'QA-E', onHand: 30 },
  { marketId: CONSERVE_MARKET, sku: 'QA-F', onHand: 50 },
];
const RACE_X = 'QA-X';
const RACE_Y = 'QA-Y';
const RACE_LEVELS: readonly StockLevel[] = [
  { marketId: RACE_MARKET, sku: RACE_X, onHand: 1 },
  { marketId: RACE_MARKET, sku: RACE_Y, onHand: 1 },
];
const CONSERVE_SKUS = CONSERVE_LEVELS.map((level) => level.sku);

/** Is yukunun tohumu: islem karisimini ve parametreleri sabitler. */
const WORKLOAD_SEED = 0x5eed0124;
const OPERATIONS = 500;
const WAVE_SIZE = 25;
/** Kullanici havuzu: B22 (kullanici basina tek aktif) de calissin ama her istegi reddetmesin. */
const USER_POOL = 200;
const TTL_SECONDS = 600;
const EXTEND_SECONDS = 120;
/** Kisaltma Redis'te gercek zamanli PEXPIRE de yazar: kosu suresinden uzun tutulur. */
const SHORTEN_TO_SECONDS = 300;
const MS_PER_SECOND = 1_000;
/** Cagiranin sonradan yeniden denemesi: CONFLICT ya da UNAVAILABLE donen istek en cok bu kadar. */
const CALLER_RETRIES = 5;
const RACE_ROUNDS = 20;
const RACE_SIDE = 50;
const RACE_ORDER_BASE = 1_000_000;
const T0 = Date.parse('2026-10-07T09:00:00.000Z');

const service = inventoryV1.InventoryServiceService;
const { RESERVATION_OUTCOME_APPLIED } = inventoryV1.ReservationOutcome;
const RETRYABLE = new Set<string>([ERROR_CODES.CONFLICT, ERROR_CODES.SERVICE_UNAVAILABLE]);
const RESERVE_REFUSALS = new Set<string>([
  ERROR_CODES.STOCK_INSUFFICIENT,
  ERROR_CODES.RESERVATION_ACTIVE,
]);

interface InventoryNode {
  readonly server: TestGrpcServer;
  readonly source: StockSource;
  readonly sweep: SweepExpired;
  /** Sunucunun ve supurucunun gunlugu (I8: error satiri yok). */
  readonly lines: LogLine[];
}

let mongoContainer: StartedMongoDBContainer;
let redisContainer: StartedRedisContainer;
let stores: StockStores;
let admin: RedisConnection;
const clock = fixedClock(T0);
const nodes: InventoryNode[] = [];

function storesEnv(): StockStoresEnv {
  return {
    mongo: {
      uri: `${mongoContainer.getConnectionString()}?directConnection=true`,
      dbName: DB_NAME,
      serverSelectionTimeoutMs: 5_000,
      operationTimeoutMs: 5_000,
    },
    redis: { REDIS_URL: redisContainer.getConnectionUrl(), REDIS_CONNECT_TIMEOUT_MS: 5_000 },
  };
}

async function startNode(name: string): Promise<void> {
  const lines: LogLine[] = [];
  const logger = recordingLogger(lines);
  const source = await openStockSource(storesEnv(), logger);
  const server = await startTestGrpcServer({
    serviceName: name,
    logger,
    services: [buildInventoryService({ stock: source, clock, logger })],
  });
  const sweep = buildSweepExpired({ stock: source, markets: source.markets, clock, logger });
  nodes.push({ server, source, sweep, lines });
}

beforeAll(async () => {
  [mongoContainer, redisContainer] = await Promise.all([
    new MongoDBContainer(MONGO_IMAGE).start(),
    new RedisContainer(REDIS_IMAGE).start(),
  ]);
  stores = await openStockStores(storesEnv(), recordingLogger([]), 'qa-korunum');
  // Uretim yolu: Mongo'ya seed (defterin acilis kayitlariyla); sayaclari acilis yazar.
  await createSeedStock({
    writer: new MongoStockSeedWriter(stores.mongo, stores.repository, stores.ledger),
    levels: [...CONSERVE_LEVELS, ...RACE_LEVELS],
    isProduction: false,
  })();
  admin = await connectRedis({ url: redisContainer.getConnectionUrl(), name: 'qa-yonetici' });
  await startNode('qa-inventory-1');
  await startNode('qa-inventory-2');
}, 120_000);

afterAll(async () => {
  for (const node of nodes.splice(0)) {
    await node.server.stop();
    await node.source.close();
  }
  await admin?.close();
  await stores?.close();
  await Promise.all([mongoContainer?.stop(), redisContainer?.stop()]);
});

/** Sabit tohumlu sozde rastgele sayi (mulberry32): [0, 1). */
function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = state;
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4_294_967_296;
  };
}

/** Fisher-Yates: cekis sayisi sabit, siralama algoritmasina bagli degil. */
function shuffled<T>(list: readonly T[], random: () => number): T[] {
  const copy = [...list];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const other = Math.floor(random() * (index + 1));
    [copy[index], copy[other]] = [copy[other] as T, copy[index] as T];
  }
  return copy;
}

type Item = { readonly sku: string; readonly quantity: number };

/** RPC'yi cagiranin sonradan yeniden denemesiyle cagirir; cevabi ya da son hatanin kodunu doner. */
async function callWithRetry<Response>(
  call: () => Promise<{ response?: Response | undefined; error?: unknown }>,
  retries: number,
): Promise<{ readonly response: Response | undefined; readonly code: string | undefined }> {
  for (let attempt = 1; ; attempt += 1) {
    const { response, error } = await call();
    if (error === undefined) return { response, code: undefined };
    // Uygulama hatasi degilse (tasima) kodu INTERNAL say: beklenmeyen.
    const code = appErrorOf(error)?.code ?? ERROR_CODES.INTERNAL;
    if (!RETRYABLE.has(code) || attempt >= retries) return { response: undefined, code };
  }
}

/** Marketin depo durumu: sayaclar (yoksa NaN), Mongo onHand, aktif rezervasyonlar ve indeks kusurlari. */
async function storeState(marketId: string, skus: readonly string[]) {
  const counters = new Map<string, number>();
  for (const sku of skus) {
    const raw = await admin.redis.get(stockAvailKey(marketId, sku));
    counters.set(sku, raw === null ? Number.NaN : Number(raw));
  }
  const onHand = new Map<string, number>();
  const stock = await stores.mongo.db
    .collection<StockDocument>(COLLECTIONS.STOCK)
    .find({ marketId })
    .toArray();
  for (const document of stock) onHand.set(document.sku, document.onHand);
  const active: { orderId: string; userId: string; items: Map<string, number> }[] = [];
  const indexFaults: string[] = [];
  for (const member of await admin.redis.zrange(reservationIndexKey(marketId), '0', '-1')) {
    const hash = await admin.redis.hgetall(reservationKey(marketId, member));
    if (hash['orderId'] === undefined) indexFaults.push(`${member}: yetim`);
    else if (hash['state'] !== undefined)
      indexFaults.push(`${member}: ${hash['state']} ama indekste`);
    else active.push({ orderId: member, userId: hash['userId'] ?? '', items: quantitiesOf(hash) });
  }
  return { counters, onHand, active, indexFaults };
}

function quantitiesOf(hash: Record<string, string>): Map<string, number> {
  const items = new Map<string, number>();
  for (const [field, value] of Object.entries(hash)) {
    if (field.startsWith('qty:')) items.set(field.slice('qty:'.length), Number(value));
  }
  return items;
}

/** I1, I2, I7, I9: sayac + aktif == onHand, sayac var ve >= 0, kullanici basina bir aktif, temiz indeks. */
async function assertConservation(label: string): Promise<void> {
  const { counters, onHand, active, indexFaults } = await storeState(
    CONSERVE_MARKET,
    CONSERVE_SKUS,
  );
  expect(indexFaults, `${label} indekste yalniz aktif (I9)`).toEqual([]);
  for (const sku of CONSERVE_SKUS) {
    const held = active.reduce((sum, reservation) => sum + (reservation.items.get(sku) ?? 0), 0);
    const counter = counters.get(sku) ?? Number.NaN;
    expect(counter, `${label} ${sku} sayac var ve eksi degil (I2)`).toBeGreaterThanOrEqual(0);
    expect(counter + held, `${label} ${sku} sayac + aktif == onHand (I1)`).toBe(onHand.get(sku));
  }
  const perUser = new Map<string, number>();
  for (const reservation of active) {
    perUser.set(reservation.userId, (perUser.get(reservation.userId) ?? 0) + 1);
  }
  const doubled = [...perUser.entries()].filter(([, count]) => count > 1);
  expect(doubled, `${label} kullanici basina en cok bir aktif (I7)`).toEqual([]);
}

/** Defterin bu marketteki sonuc kayitlari (birakma, onay, sure dolumu). */
function terminalEntries() {
  const terminal = [LEDGER_KINDS.RELEASE, LEDGER_KINDS.COMMIT, LEDGER_KINDS.EXPIRE];
  return stores.mongo.db
    .collection<StockLedgerDocument>(COLLECTIONS.STOCK_LEDGER)
    .find({ marketId: CONSERVE_MARKET, kind: { $in: terminal } })
    .toArray();
}

interface Reserved {
  readonly orderId: string;
  readonly items: readonly Item[];
}

describe('QA IQ1 karisik eszamanli yukte stok korunumu (iki sunucu, Redis + Mongo)', () => {
  it('500 islem, 20 dalga: her dalgada I1-I3, I7-I9; sonda I4-I6, bos indeks ve sayac == onHand', async () => {
    const random = seededRandom(WORKLOAD_SEED);
    const pick = <T>(list: readonly T[]): T | undefined => list[Math.floor(random() * list.length)];
    const reserved: Reserved[] = [];
    /** Bu dalgada acilanlar: ayni dalgadaki islemler onlari secemez, supurme de erisemez. */
    const fresh: Reserved[] = [];
    const refusedOrders: string[] = [];
    const unexpected: string[] = [];
    let sequence = 0;
    /** Her yol gercekten calisti mi (etkisiz uzatma ve kisaltma sayilmaz). */
    const seen = {
      reserved: 0,
      refused: 0,
      released: 0,
      committed: 0,
      extended: 0,
      shortened: 0,
      expired: 0,
    };

    const reserve = async (node: InventoryNode): Promise<void> => {
      sequence += 1;
      const id = orderId(sequence);
      const skus = shuffled(CONSERVE_SKUS, random).slice(0, 1 + Math.floor(random() * 3));
      const items = skus.map((sku) => ({ sku, quantity: 1 + Math.floor(random() * 2) }));
      const user = userId(1 + Math.floor(random() * USER_POOL));
      const { error } = await node.server.call(
        service.reserve,
        inventoryV1.ReserveRequest.fromPartial({
          orderId: id,
          marketId: CONSERVE_MARKET,
          userId: user,
          items,
          ttlSeconds: TTL_SECONDS,
        }),
      );
      if (error === undefined) {
        seen.reserved += 1;
        fresh.push({ orderId: id, items });
        return;
      }
      const code = appErrorOf(error)?.code ?? ERROR_CODES.INTERNAL;
      if (RESERVE_REFUSALS.has(code)) seen.refused += 1;
      else unexpected.push(`reserve ${id}: ${code}`);
      refusedOrders.push(id);
    };
    const settle = async (node: InventoryNode, kind: number): Promise<void> => {
      const target = pick(reserved);
      if (target === undefined) return;
      const base = { orderId: target.orderId, marketId: CONSERVE_MARKET };
      if (kind === 0) {
        const result = await callWithRetry(
          () =>
            node.server.call(
              service.release,
              inventoryV1.ReleaseRequest.fromPartial({ ...base, reason: 'cart_released' }),
            ),
          CALLER_RETRIES,
        );
        if (result.response?.outcome === RESERVATION_OUTCOME_APPLIED) seen.released += 1;
        if (result.code === ERROR_CODES.INTERNAL) unexpected.push(`release ${target.orderId}`);
      } else if (kind === 1) {
        const result = await callWithRetry(
          () => node.server.call(service.commit, inventoryV1.CommitRequest.fromPartial(base)),
          CALLER_RETRIES,
        );
        if (result.response?.outcome === RESERVATION_OUTCOME_APPLIED) seen.committed += 1;
        if (result.code === ERROR_CODES.INTERNAL) unexpected.push(`commit ${target.orderId}`);
      } else if (kind === 2) {
        // NOT_IDEMPOTENT: cagiran tekrar etmez (order istemcisiyle ayni).
        const result = await callWithRetry(
          () =>
            node.server.call(
              service.extendReservation,
              inventoryV1.ExtendReservationRequest.fromPartial({
                ...base,
                additionalSeconds: EXTEND_SECONDS,
              }),
            ),
          1,
        );
        if (result.response?.alreadyExtended === false) seen.extended += 1;
        if (result.code === ERROR_CODES.INTERNAL) unexpected.push(`extend ${target.orderId}`);
      } else {
        const result = await callWithRetry(
          () =>
            node.server.call(
              service.shortenReservation,
              inventoryV1.ShortenReservationRequest.fromPartial({
                ...base,
                maxRemainingSeconds: SHORTEN_TO_SECONDS,
              }),
            ),
          CALLER_RETRIES,
        );
        if (result.response?.shortened === true) seen.shortened += 1;
        if (result.code === ERROR_CODES.INTERNAL) unexpected.push(`shorten ${target.orderId}`);
      }
    };

    for (let wave = 1; wave <= OPERATIONS / WAVE_SIZE; wave += 1) {
      const sweeping = random() < 0.3;
      if (sweeping) clock.advance(Math.floor(random() * TTL_SECONDS) * MS_PER_SECOND);
      const operations = Array.from({ length: WAVE_SIZE }, (_, index) => {
        const node = nodes[index % nodes.length] as InventoryNode;
        const roll = random();
        if (sweeping && index < nodes.length) {
          return node.sweep().then((swept) => {
            seen.expired += swept.expired;
          });
        }
        if (roll < 0.4 || reserved.length === 0) return reserve(node);
        return settle(node, Math.floor(((roll - 0.4) / 0.6) * 4));
      });
      await Promise.all(operations);

      const label = `dalga ${wave}`;
      await assertConservation(label);
      // Sonuclanan kaydin izi defterden sonra silinir (ADR-18); I3 yeni acilanlarda denetlenir.
      for (const refused of refusedOrders.splice(0)) {
        const exists = await admin.redis.exists(reservationKey(CONSERVE_MARKET, refused));
        expect(exists, `${label} ${refused} iz (I3)`).toBe(0);
      }
      for (const { orderId: id, items } of fresh) {
        const held = quantitiesOf(await admin.redis.hgetall(reservationKey(CONSERVE_MARKET, id)));
        expect(Object.fromEntries(held), `${label} ${id} butun kalemler (I3)`).toEqual(
          Object.fromEntries(items.map((item) => [item.sku, item.quantity])),
        );
      }
      expect(unexpected, `${label} beklenmeyen hata (I8)`).toEqual([]);
      const errors = nodes.flatMap((node) =>
        node.lines.filter((line) => line.level === 'error' || line.level === 'fatal'),
      );
      expect(
        errors.map((line) => line.message),
        `${label} gunlukte error (I8)`,
      ).toEqual([]);
      // Tamamlanma sirasi eszamanliliga bagli: secim tohumla tutarli olsun diye sirali tut.
      reserved.push(...fresh.splice(0));
      reserved.sort((left, right) => left.orderId.localeCompare(right.orderId));
    }

    // Sona: saat cok ileri, iki sunucu da supurur; aktif rezervasyon ve indeks uyesi kalmaz.
    clock.advance(10 * TTL_SECONDS * MS_PER_SECOND);
    for (let round = 0; round < 20; round += 1) {
      const results = await Promise.all(nodes.map((node) => node.sweep()));
      if (results.every((result) => result.expired === 0 && result.pending === 0)) break;
    }
    const final = await storeState(CONSERVE_MARKET, CONSERVE_SKUS);
    expect(final.active).toEqual([]);
    expect(await admin.redis.zcard(reservationIndexKey(CONSERVE_MARKET)), 'indeks bos').toBe(0);
    for (const sku of CONSERVE_SKUS) {
      expect(final.counters.get(sku), `${sku} son sayac == onHand`).toBe(final.onHand.get(sku));
    }
    await assertConservation('son');

    // I4: dogal kimlik (siparis/sku/tur) ayni turu iki kez yazmayi zaten engeller; denetlenen tur karisimi.
    const entries = await terminalEntries();
    const kinds = new Map<string, Set<string>>();
    for (const entry of entries) {
      const key = entry.orderId ?? '';
      kinds.set(key, (kinds.get(key) ?? new Set()).add(entry.kind));
    }
    const mixed = [...kinds.entries()].filter(([, set]) => set.size > 1);
    expect(mixed, 'birden fazla sonuc turu (I4)').toEqual([]);
    const audit = await createCheckLedger({
      levels: stores.repository,
      ledger: stores.ledger,
      batchSize: 50,
    })();
    expect(
      audit.mismatches.filter((m) => m.marketId === CONSERVE_MARKET),
      'B24 (I5)',
    ).toEqual([]);
    // I6 defterden: P3 sonrasi tekrar ALREADY_APPLIED doner ama adedi dusuren odur.
    const committed = entries
      .filter((entry) => entry.kind === LEDGER_KINDS.COMMIT)
      .reduce((sum, entry) => sum + entry.quantity, 0);
    const initial = CONSERVE_LEVELS.reduce((sum, level) => sum + level.onHand, 0);
    const now = CONSERVE_SKUS.reduce((sum, sku) => sum + (final.onHand.get(sku) ?? 0), 0);
    expect(initial - now, 'onHand dususu == defterdeki onay adedi (I6)').toBe(committed);
    // Yuk anlamli olsun: her yol gercekten calisti (bos gecen degismez bir sey kanitlamaz).
    console.info(`QA-IQ1 yuk: ${JSON.stringify(seen)}`);
    for (const [path, count] of Object.entries(seen)) {
      expect(count, `yol hic calismadi: ${path}`).toBeGreaterThan(0);
    }
  }, 240_000);
});

describe('QA IQ2 ters sirali cok SKU yarisi (iki sunucu)', () => {
  it('20 tur x (50 {x,y} + 50 {y,x}) ayni anda: turda tam bir kazanan, iki kalemi birlikte; kaybedenler STOCK_INSUFFICIENT ve iz birakmaz', async () => {
    for (let round = 1; round <= RACE_ROUNDS; round += 1) {
      const contenders = Array.from({ length: RACE_SIDE * 2 }, (_, index) => {
        const n = RACE_ORDER_BASE + round * 1_000 + index;
        const order = index % 2 === 0 ? [RACE_X, RACE_Y] : [RACE_Y, RACE_X];
        // Sira ve sunucu ayri eksen: iki sira da iki sunucuya gider.
        const node = nodes[Math.floor(index / 2) % nodes.length] as InventoryNode;
        return { n, node, items: order.map((sku) => ({ sku, quantity: 1 })) };
      });
      const results = await Promise.all(
        contenders.map(({ n, node, items }) =>
          node.server.call(
            service.reserve,
            inventoryV1.ReserveRequest.fromPartial({
              orderId: orderId(n),
              marketId: RACE_MARKET,
              userId: userId(n),
              items,
              ttlSeconds: TTL_SECONDS,
            }),
          ),
        ),
      );
      const winners = contenders.filter((_, index) => results[index]?.error === undefined);
      const loserCodes = results
        .filter((result) => result.error !== undefined)
        .map((result) => appErrorOf(result.error)?.code);

      expect(winners, `tur ${round}: tek kazanan`).toHaveLength(1);
      expect(new Set(loserCodes), `tur ${round}: kaybedenlerin kodu`).toEqual(
        new Set([ERROR_CODES.STOCK_INSUFFICIENT]),
      );
      const [winner] = winners;
      const held = quantitiesOf(
        await admin.redis.hgetall(reservationKey(RACE_MARKET, orderId(winner?.n ?? 0))),
      );
      expect(Object.fromEntries(held)).toEqual({ [RACE_X]: 1, [RACE_Y]: 1 });
      expect(await admin.redis.get(stockAvailKey(RACE_MARKET, RACE_X))).toBe('0');
      expect(await admin.redis.get(stockAvailKey(RACE_MARKET, RACE_Y))).toBe('0');
      for (const loser of contenders.filter((contender) => contender !== winner)) {
        expect(await admin.redis.exists(reservationKey(RACE_MARKET, orderId(loser.n)))).toBe(0);
        expect(await admin.redis.exists(userReservationKey(userId(loser.n)))).toBe(0);
      }

      const released = await (nodes[round % nodes.length] as InventoryNode).server.call(
        service.release,
        inventoryV1.ReleaseRequest.fromPartial({
          orderId: orderId(winner?.n ?? 0),
          marketId: RACE_MARKET,
          reason: 'cart_released',
        }),
      );
      expect(released.error).toBeUndefined();
      expect(await admin.redis.get(stockAvailKey(RACE_MARKET, RACE_X))).toBe('1');
      expect(await admin.redis.get(stockAvailKey(RACE_MARKET, RACE_Y))).toBe('1');
    }
  }, 240_000);
});
