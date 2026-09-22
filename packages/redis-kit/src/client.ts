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
 * ILK baglanti icin TOPLAM sure butcesi (ms).
 *
 * NEDEN GEREKLI: ioredis'in `connect()` sozu ilk ECONNREFUSED'da reddeder, ama
 * arkada retryStrategy calismaya devam eder. Servis ile Redis ayni anda ayaga
 * kalkiyorsa (docker compose, Testcontainers, k8s) ilk deneme kaybedilir ve
 * servis, Redis yarim saniye sonra hazir olacakken olurdu. Bu yaris
 * Testcontainers ile gercekten gozlendi (uc kosudan birinde).
 *
 * Bu yuzden `connect()` sozu BEKLENMEZ; 'ready' olayi bu butce icinde beklenir
 * ve yeniden deneme isi kutuphanenin kendi retryStrategy'sine birakilir.
 */
const DEFAULT_READY_TIMEOUT_MS = 5_000;

export interface RedisConnectionOptions {
  /** redis://host:port[/db] */
  readonly url: string;
  readonly logger?: Logger;
  /** Ilk baglantinin hazir olmasi icin TOPLAM sure butcesi (ms). */
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
  const onError = (error: Error): void => {
    logger.error({ err: error }, 'redis baglanti hatasi');
  };
  const onReconnecting = (): void => {
    logger.warn({}, 'redis yeniden baglaniyor');
  };
  redis.on('error', onError);
  redis.on('reconnecting', onReconnecting);

  try {
    await waitUntilReady(redis, options.connectTimeoutMs ?? DEFAULT_READY_TIMEOUT_MS, logger);
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
      // Dinleyiciler ONCE kaldirilir: kapanis sirasinda gelen "baglanti koptu"
      // hatasi, zaten istedigimiz sey - gunluge hata olarak yazilmasi yaniltir
      // ve yeniden baglanma uyarisi bosuna kaydedilir.
      redis.off('error', onError);
      redis.off('reconnecting', onReconnecting);

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

/**
 * Baglantiyi baslatir ve 'ready' olayini verilen butce icinde bekler.
 *
 * `connect()` sozu bilincli olarak BEKLENMEZ: ilk deneme basarisiz olsa bile
 * ioredis retryStrategy ile denemeye devam eder ve basarili olunca 'ready'
 * yayinlar. Butce dolarsa son gorulen hata firlatilir.
 */
function waitUntilReady(redis: Redis, budgetMs: number, logger: Logger): Promise<void> {
  return new Promise((resolve, reject) => {
    let lastError: Error | undefined;

    const onReady = (): void => {
      cleanup();
      resolve();
    };
    const onError = (error: Error): void => {
      lastError = error;
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(lastError ?? new Error(`Redis ${budgetMs} ms icinde hazir olmadi`));
    }, budgetMs);

    function cleanup(): void {
      clearTimeout(timer);
      redis.off('ready', onReady);
      redis.off('error', onError);
    }

    redis.once('ready', onReady);
    redis.on('error', onError);

    redis.connect().catch(() => {
      // Ilk deneme dustu; retryStrategy devrede, butce dolana kadar bekliyoruz.
      logger.warn({}, 'redis ilk baglanti denemesi basarisiz, yeniden deneniyor');
    });
  });
}

/** Gunluge yazarken URL icindeki parolayi gizler. */
function redactUrl(url: string): string {
  return url.replace(/\/\/([^@/]*)@/, '//***@');
}
