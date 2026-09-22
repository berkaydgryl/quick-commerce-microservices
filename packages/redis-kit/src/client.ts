/**
 * Redis baglantisi.
 *
 * Bu paketin tasidigi tek istemci ioredis'tir ve TEK YERDEN kurulur: baglanti
 * secenekleri (yeniden deneme, zaman asimi, hata dinleyicisi) her serviste
 * ayni olsun diye.
 *
 * NEDEN ioredis: Lua (EVALSHA), Streams ve pub/sub uclarinin tamamini tasiyor,
 * Cluster'a gecis icin ayni API kaliyor ve yeniden baglanma stratejisi
 * yapilandirilabilir.
 */

import { AppError, ERROR_CODES, silentLogger } from '@getir/core';
import type { Logger } from '@getir/core';
import { Redis } from 'ioredis';

/** Yeniden baglanma bekleme suresi: her denemede artar, bu tavanda durur. */
const MAX_RETRY_DELAY_MS = 2_000;
const RETRY_DELAY_STEP_MS = 100;

/**
 * Tek bir komutun kac kez yeniden denenecegi.
 * null yerine sayi: kuyrukta sonsuza kadar bekleyen komut, zarif kapanisi
 * kilitler ve hatayi gizler.
 */
const MAX_RETRIES_PER_REQUEST = 3;

/**
 * ILK baglanti icin deneme sayisi ve bekleme adimi.
 *
 * NEDEN GEREKLI: ioredis'in retryStrategy'si KOPAN baglantiyi toparlar, ama
 * `connect()` ilk ECONNREFUSED'da reddeder. Servis ile Redis ayni anda ayaga
 * kalkiyorsa (docker compose, Testcontainers, k8s) bu yaris kaybedilir ve
 * servis, Redis bir saniye sonra hazir olacak olmasina ragmen oler.
 * Testcontainers ile bu yaris gercekten gozlendi: ayni test bir kosuda gecip
 * digerinde "baglanti kurulamadi" ile dustu.
 */
const CONNECT_ATTEMPTS = 5;
const CONNECT_RETRY_STEP_MS = 200;

export interface RedisConnectionOptions {
  /** redis://host:port[/db] */
  readonly url: string;
  readonly logger?: Logger;
  /** Ilk baglanti icin beklenecek en uzun sure (ms). */
  readonly connectTimeoutMs?: number;
  /** Gunlukte gorunen ad; hangi servisin baglantisi oldugunu soyler. */
  readonly name?: string;
}

export interface RedisConnection {
  readonly redis: Redis;
  /** Baglanti canli mi? Health ucu bunu cagirir. */
  ping(): Promise<boolean>;
  /** Kuyruktaki komutlarin bitmesini bekleyerek kapatir. */
  close(): Promise<void>;
}

/** Baglanir ve ilk PING'i dogrular; basarisizsa AppError firlatir. */
export async function connectRedis(options: RedisConnectionOptions): Promise<RedisConnection> {
  const logger = (options.logger ?? silentLogger).child({ component: 'redis' });

  const redis = new Redis(options.url, {
    // lazyConnect: baglanti kurucuda DEGIL, asagida acikca kurulur; boylece
    // basarisizlik yakalanabilir bir sozde doner, sessiz bir olayda degil.
    lazyConnect: true,
    maxRetriesPerRequest: MAX_RETRIES_PER_REQUEST,
    enableReadyCheck: true,
    ...(options.connectTimeoutMs === undefined ? {} : { connectTimeout: options.connectTimeoutMs }),
    ...(options.name === undefined ? {} : { connectionName: options.name }),
    retryStrategy: (attempt: number) => Math.min(attempt * RETRY_DELAY_STEP_MS, MAX_RETRY_DELAY_MS),
  });

  // Dinleyici SART: ioredis'te 'error' olayinin dinleyicisi yoksa Node
  // yakalanmamis hata olarak processi devirir - Redis kisa bir an duserse bile.
  redis.on('error', (error: Error) => {
    logger.error({ err: error }, 'redis baglanti hatasi');
  });
  redis.on('reconnecting', () => {
    logger.warn({}, 'redis yeniden baglaniyor');
  });

  try {
    await connectWithRetry(redis, logger);
    await redis.ping();
  } catch (error: unknown) {
    redis.disconnect();
    throw new AppError(
      ERROR_CODES.SERVICE_UNAVAILABLE,
      `Redis baglantisi kurulamadi: ${redactUrl(options.url)}`,
      { cause: error },
    );
  }

  logger.info({ url: redactUrl(options.url) }, 'redis baglantisi hazir');

  return {
    redis,
    ping: async () => (await redis.ping()) === 'PONG',
    close: async () => {
      try {
        // quit: kuyruktaki komutlar bitsin, sonra kapan. disconnect anida keser.
        await redis.quit();
      } catch (error: unknown) {
        logger.warn({ err: error }, 'redis kapanisi temiz olmadi, baglanti kesiliyor');
        redis.disconnect();
      }
    },
  };
}

/** Ilk baglantiyi artan beklemeyle birkac kez dener; son hatayi firlatir. */
async function connectWithRetry(redis: Redis, logger: Logger): Promise<void> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= CONNECT_ATTEMPTS; attempt += 1) {
    try {
      await redis.connect();
      return;
    } catch (error: unknown) {
      lastError = error;
      if (attempt === CONNECT_ATTEMPTS) {
        break;
      }
      logger.warn({ attempt, of: CONNECT_ATTEMPTS }, 'redis henuz hazir degil, yeniden denenecek');
      await delay(attempt * CONNECT_RETRY_STEP_MS);
    }
  }

  throw lastError;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/** Gunluge yazarken URL icindeki parolayi gizler. */
function redactUrl(url: string): string {
  return url.replace(/\/\/([^@/]*)@/, '//***@');
}
