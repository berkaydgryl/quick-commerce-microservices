/**
 * risk_events deposunu ACAR: MOCK=true -> bellek, aksi halde Mongo. Baglanmak,
 * indeks kurmak ve hata olursa baglantiyi birakmak altyapi isidir.
 */

import type { Logger } from '@getir/core';
import { connectMongo } from '@getir/mongo-kit';
import type { MongoEnv } from '@getir/mongo-kit';

import { SERVICE_NAME } from '../config/constants.js';
import type { RiskEventRepository } from '../domain/risk-event-repository.js';
import { InMemoryRiskEventStore } from './memory/in-memory-risk-event-store.js';
import { RiskEventMongoStore } from './mongo/risk-event-mongo-store.js';
import { RiskEventsCollection } from './mongo/risk-events-collection.js';

export interface RiskEventStore {
  readonly repository: RiskEventRepository;
  readonly name: 'bellek (MOCK)' | 'mongo';
  /** Kapanista EN SON cagrilir (once cagrilar, sonra veritabani). */
  close(): Promise<void>;
}

export async function openRiskEventStore(
  mongo: MongoEnv | undefined,
  logger: Logger,
): Promise<RiskEventStore> {
  if (mongo === undefined) {
    return {
      repository: new InMemoryRiskEventStore(),
      name: 'bellek (MOCK)',
      close: () => Promise.resolve(),
    };
  }

  const connection = await connectMongo({
    uri: mongo.MONGO_URI,
    dbName: mongo.MONGO_DB,
    serverSelectionTimeoutMs: mongo.MONGO_SERVER_SELECTION_TIMEOUT_MS,
    appName: SERVICE_NAME,
    logger,
  });

  const events = new RiskEventsCollection(connection.db);
  try {
    await events.ensureIndexes();
  } catch (error: unknown) {
    await connection.close();
    throw error;
  }

  return {
    repository: new RiskEventMongoStore(events),
    name: 'mongo',
    close: () => connection.close(),
  };
}
