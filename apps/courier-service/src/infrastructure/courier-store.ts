/**
 * couriers deposunu, market konumu kopyasini ve rotalari ACAR: MOCK=true -> demo
 * kuryeleri ve marketlerle dolu bellek, aksi halde Mongo. Baglanmak, gocleri
 * ve indeksleri kurmak ve hata olursa baglantiyi birakmak altyapi isidir.
 */

import type { Clock, Logger } from '@getir/core';
import { applyMigrations, connectMongo } from '@getir/mongo-kit';
import type { MongoEnv } from '@getir/mongo-kit';

import { SERVICE_NAME } from '../config/constants.js';
import type { CourierRepository } from '../domain/courier-repository.js';
import { courierFromSeed } from '../domain/courier-seed.js';
import type { MarketLocator } from '../domain/market-locator.js';
import type { RouteRepository } from '../domain/route-repository.js';
import { MIGRATIONS } from '../migrations/index.js';
import { COURIER_SEEDS, MARKET_LOCATION_SEEDS } from './fixtures/couriers.js';
import { InMemoryCourierStore } from './memory/in-memory-courier-store.js';
import { InMemoryRouteStore } from './memory/in-memory-route-store.js';
import { CourierMongoStore } from './mongo/courier-mongo-store.js';
import { CouriersCollection } from './mongo/couriers-collection.js';
import { MarketsCollection } from './mongo/markets-collection.js';
import { RouteMongoStore } from './mongo/route-mongo-store.js';
import { RoutesCollection } from './mongo/routes-collection.js';

export interface CourierStore {
  readonly repository: CourierRepository;
  /** Market konumu kopyasi (T13.2): havuzun merkezi. */
  readonly markets: MarketLocator;
  /** Siparislerin kurye rotalari (T13.2). */
  readonly routes: RouteRepository;
  readonly name: 'bellek (MOCK)' | 'mongo';
  /** Kapanista EN SON cagrilir (once cagrilar, sonra veritabani). */
  close(): Promise<void>;
}

export async function openCourierStore(
  mongo: MongoEnv | undefined,
  options: { readonly logger: Logger; readonly clock: Clock },
): Promise<CourierStore> {
  if (mongo === undefined) {
    // MOCK'ta seed komutu yok: demo kuryeleri acilista bellege yuklenir.
    const at = options.clock.date();
    const memory = new InMemoryCourierStore(
      COURIER_SEEDS.map((seed) => courierFromSeed(seed, at)),
      MARKET_LOCATION_SEEDS,
    );
    return {
      repository: memory,
      markets: memory,
      routes: new InMemoryRouteStore(),
      name: 'bellek (MOCK)',
      close: () => Promise.resolve(),
    };
  }

  const connection = await connectMongo({
    ...mongo,
    appName: SERVICE_NAME,
    logger: options.logger,
  });

  const couriers = new CouriersCollection(connection.db);
  const markets = new MarketsCollection(connection.db);
  const routes = new RoutesCollection(connection.db);
  try {
    // Gocler indekslerden ONCE (T10.4, ADR-19): kod uygulanmamis semayla calismaz.
    await applyMigrations(connection, MIGRATIONS, options.logger);
    await couriers.ensureIndexes();
    await markets.ensureIndexes();
    await routes.ensureIndexes();
  } catch (error: unknown) {
    await connection.close();
    throw error;
  }

  const store = new CourierMongoStore(couriers, markets);
  return {
    repository: store,
    markets: store,
    routes: new RouteMongoStore(routes),
    name: 'mongo',
    close: () => connection.close(),
  };
}
