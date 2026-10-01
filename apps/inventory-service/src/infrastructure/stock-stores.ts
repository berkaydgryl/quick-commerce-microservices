/**
 * Kalici stok (Mongo) ve hizli sayac (Redis) baglantilarini ACAR (ADR-03).
 * Servis, seed ve reseed ayni yoldan acar: indeks, tahliye denetimi (P1) ve
 * kapanis sirasi tek yerde.
 */

import type { Logger } from '@getir/core';
import { connectMongo } from '@getir/mongo-kit';
import type { MongoConnection } from '@getir/mongo-kit';
import { connectRedis } from '@getir/redis-kit';
import type { RedisConnection } from '@getir/redis-kit';

import type { StockStoresEnv } from '../config/env.js';
import { assertNoEviction } from './redis/eviction-policy.js';
import { RedisCounterSetMarker } from './redis/redis-counter-set-marker.js';
import { RedisStockCounters } from './redis/redis-stock-counters.js';
import { MongoStockCommitter } from './mongo/mongo-stock-committer.js';
import { StockLedgerRepository } from './mongo/stock-ledger-repository.js';
import { StockRepository } from './mongo/stock-repository.js';

export interface StockStores {
  readonly mongo: MongoConnection;
  readonly redis: RedisConnection;
  readonly repository: StockRepository;
  /** Stok defteri (T10.2, ADR-18). */
  readonly ledger: StockLedgerRepository;
  /** Onayin yazimi: defter + eldeki adet, tek transaction (T10.2 PR 2). */
  readonly committer: MongoStockCommitter;
  readonly counters: RedisStockCounters;
  /** Sayac kumesinin isareti (ADR-17); seed en son bunu yazar. */
  readonly marker: RedisCounterSetMarker;
  /** Once Redis, sonra Mongo (proje kurali: once cagrilar, en son veritabani). */
  close(): Promise<void>;
}

export async function openStockStores(
  stores: StockStoresEnv,
  logger: Logger,
  appName: string,
): Promise<StockStores> {
  const mongo = await connectMongo({
    uri: stores.mongo.MONGO_URI,
    dbName: stores.mongo.MONGO_DB,
    serverSelectionTimeoutMs: stores.mongo.MONGO_SERVER_SELECTION_TIMEOUT_MS,
    appName,
    logger,
  });

  let redis: RedisConnection | undefined;
  try {
    const repository = new StockRepository(mongo.db);
    const ledger = new StockLedgerRepository(mongo.db);
    await repository.ensureIndexes();
    await ledger.ensureIndexes();
    redis = await connectRedis({
      url: stores.redis.REDIS_URL,
      connectTimeoutMs: stores.redis.REDIS_CONNECT_TIMEOUT_MS,
      name: appName,
      logger,
    });
    // Sayac yazilmadan ONCE: tahliye eden bir Redis'e stok yazilmaz (P1).
    await assertNoEviction(redis.redis);

    const opened = redis;
    return {
      mongo,
      redis: opened,
      repository,
      ledger,
      committer: new MongoStockCommitter(mongo, repository, ledger, logger),
      counters: new RedisStockCounters(opened.redis, logger),
      marker: new RedisCounterSetMarker(opened.redis),
      close: async () => {
        await opened.close();
        await mongo.close();
      },
    };
  } catch (error: unknown) {
    // Acik kalan baglanti processi kapatmaz ve hatayi gizler.
    await redis?.close();
    await mongo.close();
    throw error;
  }
}
