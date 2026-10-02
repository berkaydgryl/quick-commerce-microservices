/**
 * MongoDB baglantisi ve transaction yardimcisi.
 *
 * TEK YERDEN KURULUM: baglanti secenekleri (zaman asimi, yazma endisesi,
 * uygulama adi) her serviste ayni olsun diye burada toplanir.
 *
 * ISLEM SURESI (#51): `operationTimeoutMs` verilirse `db` uzerinden yapilan her
 * islem ve her transaction bu sureyle sinirlidir (surucunun timeoutMS'i, CSOT):
 * Mongo cevap vermeden donarsa cagri sure dolunca SERVICE_UNAVAILABLE ile doner,
 * baglanti kapatilir, havuz tukenmez. Istemcinin kendisi suresizdir: acilis isleri
 * (gocler) ayni havuzun `unbounded` gorunumunu kullanir ve yarida kesilmez.
 *
 * REPLICA SET NOTU: Mongo tek dugumlu replica set (rs0) olarak calisir.
 * Gerekce ADR-04'tur - outbox kaydi is verisiyle AYNI transaction icinde
 * yazilmak zorunda ve MongoDB'de cok belgeli transaction yalnizca replica set
 * uzerinde calisir.
 */

import { AppError, ERROR_CODES, redactConnectionString, silentLogger } from '@getir/core';
import type { Logger } from '@getir/core';
import { MongoClient } from 'mongodb';
import type { ClientSession, Db, TransactionOptions } from 'mongodb';

import { isAuthenticationError, retryableTransactionCause, toMongoAppError } from './errors.js';

/** Sunucu secimi icin varsayilan bekleme (ms). */
const DEFAULT_SERVER_SELECTION_TIMEOUT_MS = 5_000;

/**
 * Islem suresi yok (#51): eski davranis. Seed ve goc komutlari boyle baglanir;
 * islem basina verildiginde (`{ timeoutMS: 0 }`) o islemi suresiz yapar.
 */
export const NO_OPERATION_TIMEOUT = 0;

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
  /**
   * `db` islemlerinin ve transaction'in ust suresi (ms, #51). Verilmezse ya da
   * NO_OPERATION_TIMEOUT ise suresiz (eski davranis).
   */
  readonly operationTimeoutMs?: number;
}

export interface WithTransactionOptions {
  /**
   * false: es zamanli yazimda (WriteConflict) surucu geri cagriyi KENDISI
   * tekrar denemez; hata CONFLICT olarak doner ve cagiran sinirli, beklemeli
   * yeniden denemeyi kendisi yapar (retryOnConflict, roadmap P3). Surucunun
   * denemesi sure dolana kadar surer (islem suresi yoksa 120 sn, varsa o sure;
   * #51) ve sonunda SERVICE_UNAVAILABLE olur; sicak bir kayitta P3'un "en cok 3
   * deneme" kurali ancak boyle uygulanir.
   * Varsayilan true (T7.3 davranisi).
   */
  readonly retryTransientErrors?: boolean;
}

/** Veritabani tutamagi ve transaction'i: ikisi ayni sureyle (#51). */
export interface MongoDatabase {
  readonly db: Db;
  /**
   * Verilen isi tek transaction icinde calistirir.
   * Callback hata firlatirsa transaction geri alinir (rollback).
   */
  withTransaction<T>(
    work: (session: ClientSession) => Promise<T>,
    options?: WithTransactionOptions,
  ): Promise<T>;
}

export interface MongoConnection extends MongoDatabase {
  readonly client: MongoClient;
  /**
   * Ayni havuzun SURESIZ gorunumu (#51): yalnizca acilis isleri (gocler). Uzun
   * bir goc islem suresine takilip yarida kesilmesin; istek ve isci isleri
   * `db`'yi kullanir.
   */
  readonly unbounded: MongoDatabase;
  /** Baglanti canli mi? Health ucu bunu cagirir; islem suresiyle sinirli. */
  ping(): Promise<boolean>;
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
    const uri = redactConnectionString(options.uri);
    // Yanlis kullanici ya da parola beklemekle duzelmez: gecici hata gibi
    // (SERVICE_UNAVAILABLE) gosterilirse sebebi ag sorunu sanilir (D14).
    if (isAuthenticationError(error)) {
      throw AppError.internal(`Mongo kimlik dogrulamasi reddedildi (kullanici/parola): ${uri}`, {
        cause: error,
      });
    }
    throw new AppError(ERROR_CODES.SERVICE_UNAVAILABLE, `Mongo baglantisi kurulamadi: ${uri}`, {
      cause: error,
    });
  }

  const operationTimeoutMs = options.operationTimeoutMs ?? NO_OPERATION_TIMEOUT;
  // Sure veritabani tutamagina verilir, istemciye DEGIL: tutamaktan acilan her
  // koleksiyon ve islem onu miras alir, suresiz gorunum ayni havuzu paylasir.
  // Islem kendi seceneginde sure tasimaz: surucu, sureli transaction'in icinde
  // isleme verilen timeoutMS'i reddeder (miras alinani degil).
  const unboundedDb = client.db(options.dbName);
  const db =
    operationTimeoutMs === NO_OPERATION_TIMEOUT
      ? unboundedDb
      : client.db(options.dbName, { timeoutMS: operationTimeoutMs });
  logger.info(
    { uri: redactConnectionString(options.uri), db: options.dbName, operationTimeoutMs },
    'mongo baglantisi hazir',
  );

  return {
    client,
    db,
    withTransaction: transactionRunner(client, operationTimeoutMs),
    unbounded: {
      db: unboundedDb,
      withTransaction: transactionRunner(client, NO_OPERATION_TIMEOUT),
    },
    ping: async () => {
      try {
        await db.command({ ping: 1 });
        return true;
      } catch (error: unknown) {
        logger.warn({ err: error }, 'mongo ping basarisiz');
        return false;
      }
    },

    close: async () => {
      await client.close();
      logger.info({}, 'mongo baglantisi kapandi');
    },
  };
}

/**
 * Transaction calistiricisi. Sure verilirse (#51) BUTUN transaction'i sinirlar:
 * icindeki islemler, commit ve surucunun yeniden denemeleri (suresiz halde 120 sn
 * tavan). Sure dolunca surucu transaction'i geri alir; geri alma icin sureyi
 * bastan baslatir, bu yuzden donmus Mongo'da cagri en gec iki surede doner.
 */
function transactionRunner(
  client: MongoClient,
  timeoutMs: number,
): MongoDatabase['withTransaction'] {
  const transactionOptions =
    timeoutMs === NO_OPERATION_TIMEOUT
      ? TRANSACTION_OPTIONS
      : { ...TRANSACTION_OPTIONS, timeoutMS: timeoutMs };
  return async <T>(
    work: (session: ClientSession) => Promise<T>,
    options: WithTransactionOptions = {},
  ): Promise<T> => {
    const driverRetries = options.retryTransientErrors ?? true;
    const session = client.startSession();
    try {
      return await session.withTransaction(async () => {
        try {
          return await work(session);
        } catch (error: unknown) {
          // Etiketli asil hata surucuye GERI verilir: surucu transaction'i
          // bastan tekrar dener (es zamanli yazimda kaybeden, yeniden
          // denemede guncel surumu gorur ve kendi CONFLICT'ini uretir).
          // Istenmezse etiketsiz AppError gider: surucu denemez, cagiran dener.
          throw driverRetries ? (retryableTransactionCause(error) ?? error) : error;
        }
      }, transactionOptions);
    } catch (error: unknown) {
      throw toMongoAppError(error, { operation: 'withTransaction' });
    } finally {
      // endSession her durumda cagrilmali; aksi halde sunucu tarafinda
      // oturum, suresi dolana kadar acik kalir.
      await session.endSession();
    }
  };
}
