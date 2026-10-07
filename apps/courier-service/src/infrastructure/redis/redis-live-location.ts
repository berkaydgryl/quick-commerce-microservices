/**
 * LiveLocationStore'un Redis uygulamasi (T13.3): courier:{courierId}:last
 * (redis-kit courierLastKey), JSON {lat, lng, at}. Kisa omurlu (TTL; proje
 * kurali): kurye durunca konum kendiliginden duser, GetCourier Mongo'daki son
 * konuma doner. Okunan deger semadan gecer; bozuk kayit yok sayilir.
 *
 * KONUM GUNLUGE DUSMEZ: ioredis'in komut hatasi komutun argumanlarini
 * (anahtar ve DEGER: koordinat) `command.args` alaninda tasir; tick o hatayi
 * WARN olarak yazar. Yazim hatasi bu yuzden argumansiz bir hataya cevrilir;
 * asil hata `cause` olarak da baglanmaz (gunlukcu cause'u yazar).
 */

import { AppError } from '@getir/core';
import type { RedisConnection } from '@getir/redis-kit';
import { courierLastKey } from '@getir/redis-kit';
import { z } from 'zod';

import type { LiveLocation, LiveLocationStore } from '../../domain/live-location.js';

const storedSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  at: z.string().datetime(),
});

export class RedisLiveLocationStore implements LiveLocationStore {
  constructor(
    private readonly redis: RedisConnection['redis'],
    /** Kaydin omru (ms; config/tick-timing.ts liveTtlMs). */
    private readonly ttlMs: number,
  ) {}

  async save(courierId: string, live: LiveLocation): Promise<void> {
    const value = JSON.stringify({
      lat: live.location.lat,
      lng: live.location.lng,
      at: live.at.toISOString(),
    });
    try {
      await this.redis.set(courierLastKey(courierId), value, 'PX', this.ttlMs);
    } catch (error: unknown) {
      // Sunucu cevabi (READONLY, OOM, NOPERM ...) deger icermez; adi ve mesaji kalir.
      throw AppError.internal('canli konum yazilamadi', {
        details: {
          courierId,
          reason: error instanceof Error ? `${error.name}: ${error.message}` : 'bilinmeyen hata',
        },
      });
    }
  }

  async find(courierId: string): Promise<LiveLocation | null> {
    const raw = await this.redis.get(courierLastKey(courierId));
    if (raw === null) {
      return null;
    }
    const parsed = storedSchema.safeParse(safeJson(raw));
    return parsed.success
      ? { location: { lat: parsed.data.lat, lng: parsed.data.lng }, at: new Date(parsed.data.at) }
      : null;
  }
}

function safeJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}
