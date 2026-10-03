/**
 * Son yayinlanan surumun Redis deposu (T12.3, D1): realtime:{orderId}:seq.
 *
 * Tek uyeli sorted set; puan surumdur. Tek MULTI icinde: ZSCORE (onceki deger)
 * + ZADD GT (yalnizca daha buyukse yazar) + PEXPIRE (omur her yazimda yenilenir).
 * MULTI atomiktir: iki kopya ayni anda yazsa da kayit en buyuk surumde kalir ve
 * her biri kendi yazimindan HEMEN ONCEKI degeri gorur. Lua betigi gerekmez,
 * imaja calisma aninda okunan dosya girmez.
 *
 * Komutlar adapter'in yayin (pub) baglantisini paylasir (D5): o baglanti abone
 * moduna gecmez; tuketicinin baglantisi ise XREADGROUP BLOCK ile mesguldur.
 */

import { AppError } from '@getir/core';
import { realtimeSeqKey } from '@getir/redis-kit';
import type { RedisConnection } from '@getir/redis-kit';
import { z } from 'zod';

import type { SeqStore } from '../application/seq-store.js';

/** Sorted set'in tek uyesi. */
const SEQ_MEMBER = 'seq';

/** MULTI cevabi: [hata, sonuc] ciftleri. ZSCORE metin ya da null, digerleri sayi. */
const execResultSchema = z.tuple([
  z.tuple([z.null(), z.string().nullable()]),
  z.tuple([z.null(), z.number()]),
  z.tuple([z.null(), z.number()]),
]);

export interface RedisSeqStoreOptions {
  readonly redis: RedisConnection['redis'];
  /** Anahtarin omru (ms); her yazimda yenilenir. */
  readonly ttlMs: number;
}

export function createRedisSeqStore(options: RedisSeqStoreOptions): SeqStore {
  return {
    recordIfNewer: async (orderId, seq) => {
      const key = realtimeSeqKey(orderId);
      const results: unknown = await options.redis
        .multi()
        .zscore(key, SEQ_MEMBER)
        .zadd(key, 'GT', seq, SEQ_MEMBER)
        .pexpire(key, options.ttlMs)
        .exec();
      const parsed = execResultSchema.safeParse(results);
      if (!parsed.success) {
        // Komut hatasi (WRONGTYPE) ya da beklenmeyen cevap: olay onaylanmaz, yeniden denenir.
        throw AppError.internal('Surum kaydi beklenmeyen cevap verdi', {
          details: { key },
          cause: firstError(results),
        });
      }
      const previous = parsed.data[0][1];
      return previous === null ? undefined : Number(previous);
    },
  };
}

/** MULTI cevabindaki ilk komut hatasi (gunluk icin). */
function firstError(results: unknown): unknown {
  if (!Array.isArray(results)) {
    return results;
  }
  for (const entry of results) {
    if (Array.isArray(entry) && entry[0] instanceof Error) {
      return entry[0];
    }
  }
  return undefined;
}
