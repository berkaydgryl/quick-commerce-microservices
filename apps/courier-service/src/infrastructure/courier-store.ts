/**
 * couriers deposunu ACAR: MOCK=true -> demo kuryeleriyle dolu bellek, aksi
 * halde Mongo. Baglanmak, gocleri ve indeksleri kurmak ve hata olursa
 * baglantiyi birakmak altyapi isidir.
 */

import type { Clock, Logger } from '@getir/core';
import { applyMigrations, connectMongo } from '@getir/mongo-kit';
import type { MongoEnv } from '@getir/mongo-kit';

import { SERVICE_NAME } from '../config/constants.js';
import type { CourierRepository } from '../domain/courier-repository.js';
import { courierFromSeed } from '../domain/courier-seed.js';
import { MIGRATIONS } from '../migrations/index.js';
import { COURIER_SEEDS } from './fixtures/couriers.js';
import { InMemoryCourierStore } from './memory/in-memory-courier-store.js';
import { CourierMongoStore } from './mongo/courier-mongo-store.js';
import { CouriersCollection } from './mongo/couriers-collection.js';

export interface CourierStore {
  readonly repository: CourierRepository;
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
    return {
      repository: new InMemoryCourierStore(COURIER_SEEDS.map((seed) => courierFromSeed(seed, at))),
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
  try {
    // Gocler indekslerden ONCE (T10.4, ADR-19): kod uygulanmamis semayla calismaz.
    await applyMigrations(connection, MIGRATIONS, options.logger);
    await couriers.ensureIndexes();
  } catch (error: unknown) {
    await connection.close();
    throw error;
  }

  return {
    repository: new CourierMongoStore(couriers),
    name: 'mongo',
    close: () => connection.close(),
  };
}
