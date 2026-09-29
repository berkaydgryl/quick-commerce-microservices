/**
 * Redis'in tahliye politikasi denetimi (roadmap P1).
 *
 * `maxmemory-policy` noeviction DEGILSE stok servisi acilmaz: bellek dolunca
 * Redis stok sayacini ya da rezervasyon indeksini silebilir; bu onbellek
 * kacirmasi degil fazla satistir. Politika OKUNAMAZSA da acilmaz (yonetilen
 * Redis CONFIG komutunu kapatabilir): guvenli taraf, yanlis yapilandirilmis
 * bir Redis'e sayac yazmamaktir.
 */

import { AppError } from '@getir/core';
import type { RedisConnection } from '@getir/redis-kit';

import { REQUIRED_EVICTION_POLICY } from '../../config/constants.js';

type RedisClient = RedisConnection['redis'];

export async function assertNoEviction(redis: RedisClient): Promise<void> {
  let reply: unknown;
  try {
    reply = await redis.config('GET', 'maxmemory-policy');
  } catch (error: unknown) {
    throw AppError.internal(
      `Redis maxmemory-policy okunamadi (CONFIG GET); stok sayaci yazilmaz. Politika ${REQUIRED_EVICTION_POLICY} olmali (roadmap P1)`,
      { cause: error },
    );
  }
  // CONFIG GET cevabi [ad, deger] ciftidir (RESP2); baska bicim de reddedilir.
  const policy: unknown = Array.isArray(reply) ? (reply as unknown[])[1] : undefined;
  if (policy !== REQUIRED_EVICTION_POLICY) {
    throw AppError.internal(
      `Redis maxmemory-policy "${String(policy)}"; stok sayaci icin ${REQUIRED_EVICTION_POLICY} zorunlu (roadmap P1): bellek dolunca sayac silinirse fazla satis olur`,
      { details: { maxmemoryPolicy: String(policy) } },
    );
  }
}
