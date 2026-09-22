/**
 * MongoDB baglantisi ve transaction yardimcisi.
 *
 * TEK YERDEN KURULUM: baglanti secenekleri (zaman asimi, yazma endisesi,
 * uygulama adi) her serviste ayni olsun diye burada toplanir.
 *
 * REPLICA SET NOTU: Mongo tek dugumlu replica set (rs0) olarak calisir.
 * Gerekce ADR-04'tur - outbox kaydi is verisiyle AYNI transaction icinde
 * yazilmak zorunda ve MongoDB'de cok belgeli transaction yalnizca replica set
 * uzerinde calisir.
 */

import { AppError, ERROR_CODES, silentLogger } from '@getir/core';
import type { Logger } from '@getir/core';
import { MongoClient } from 'mongodb';
import type { ClientSession, Db, TransactionOptions } from 'mongodb';

import { toMongoAppError } from './errors.js';

/** Sunucu secimi icin varsayilan bekleme (ms). */
const DEFAULT_SERVER_SELECTION_TIMEOUT_MS = 5_000;

/**
 * Transaction ayarlari.
 *
 * - readConcern "snapshot": transaction boyunca tutarli tek bir goruntu okunur.
 * - writeConcern "majority": yazim cogunluga ulasmadan basarili sayilmaz;
 *   tek dugumlu replica set'te bu zaten o dugumdur, ama ayar ileride ikinci
 *   dugum eklenince davranisi degistirmesin diye acikca yaziliyor.
 * - readPreference "primary": transaction icinde secondary'den okumak yasaktir.
 */
const TRANSACTION_OPTIONS: TransactionOptions = {
  readConcern: { level: 'snapshot' },
  writeConcern: { w: 'majority' },
  readPreference: 'primary',
};

export interface MongoConnectionOptions {
  readonly uri: string;
  readonly dbName: string;
  readonly logger?: Logger;
  /** Mongo gunluklerinde gorunen uygulama adi; hangi servisin baglantisi? */
  readonly appName?: string;
  readonly serverSelectionTimeoutMs?: number;
}

export interface MongoConnection {
  readonly client: MongoClient;
  readonly db: Db;
  /** Baglanti canli mi? Health ucu bunu cagirir. */
  ping(): Promise<boolean>;
  /**
   * Verilen isi tek transaction icinde calistirir.
   * Callback hata firlatirsa transaction geri alinir (rollback).
   */
  withTransaction<T>(work: (session: ClientSession) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

/** Baglanir ve ilk ping'i dogrular; basarisizsa AppError firlatir. */
export async function connectMongo(options: MongoConnectionOptions): Promise<MongoConnection> {
  const logger = (options.logger ?? silentLogger).child({ component: 'mongo' });

  const client = new MongoClient(options.uri, {
    serverSelectionTimeoutMS:
      options.serverSelectionTimeoutMs ?? DEFAULT_SERVER_SELECTION_TIMEOUT_MS,
    ...(options.appName === undefined ? {} : { appName: options.appName }),
  });

  try {
    await client.connect();
    await client.db(options.dbName).command({ ping: 1 });
  } catch (error: unknown) {
    await client.close().catch(() => undefined);
    throw new AppError(
      ERROR_CODES.SERVICE_UNAVAILABLE,
      `Mongo baglantisi kurulamadi: ${redactUri(options.uri)}`,
      { cause: error },
    );
  }

  const db = client.db(options.dbName);
  logger.info({ uri: redactUri(options.uri), db: options.dbName }, 'mongo baglantisi hazir');

  return {
    client,
    db,
    ping: async () => {
      try {
        await db.command({ ping: 1 });
        return true;
      } catch (error: unknown) {
        logger.warn({ err: error }, 'mongo ping basarisiz');
        return false;
      }
    },

    withTransaction: async <T>(work: (session: ClientSession) => Promise<T>): Promise<T> => {
      const session = client.startSession();
      try {
        return await session.withTransaction(() => work(session), TRANSACTION_OPTIONS);
      } catch (error: unknown) {
        throw toMongoAppError(error, { operation: 'withTransaction' });
      } finally {
        // endSession her durumda cagrilmali; aksi halde sunucu tarafinda
        // oturum, suresi dolana kadar acik kalir.
        await session.endSession();
      }
    },

    close: async () => {
      await client.close();
      logger.info({}, 'mongo baglantisi kapandi');
    },
  };
}

/** Gunluge yazarken baglanti dizesindeki parolayi gizler. */
function redactUri(uri: string): string {
  return uri.replace(/\/\/([^@/]*)@/, '//***@');
}
