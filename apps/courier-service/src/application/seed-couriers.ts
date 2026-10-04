/**
 * Use-case: couriers koleksiyonunu demo kuryeleriyle bastan yazar (T13.1).
 *
 * Yazmadan ONCE veri dogrulanir: bicimi bozuk kimlik, yinelenen kurye, bos ad
 * ya da gecersiz konum yazimi durdurur. Yanlis veri yarim yazilmaz; yazim tek
 * transaction'dadir (writer).
 *
 * Tekrar kosmak kuryeleri IDLE'a ve marketlerinin konumuna dondurur (demo
 * sifirlamasi): atanmis kuryeler de bosa cikar. production'da REDDEDER.
 */

import { geoPointSchema, marketIdSchema } from '@getir/contracts';
import { AppError, ID_PREFIX, isId } from '@getir/core';
import type { Clock } from '@getir/core';

import type { CourierSeedWriter } from '../domain/courier-repository.js';
import { courierFromSeed } from '../domain/courier-seed.js';
import type { CourierSeed } from '../domain/courier-seed.js';

export interface SeedCouriersDeps {
  readonly writer: CourierSeedWriter;
  readonly seeds: readonly CourierSeed[];
  readonly isProduction: boolean;
  readonly clock: Clock;
}

export interface SeedCouriersResult {
  readonly markets: number;
  readonly couriers: number;
}

export type SeedCouriers = () => Promise<SeedCouriersResult>;

export function createSeedCouriers(deps: SeedCouriersDeps): SeedCouriers {
  return async () => {
    if (deps.isProduction) {
      throw AppError.validation('production ortaminda demo kuryeleri yazilmaz');
    }
    assertValidSeeds(deps.seeds);
    const at = deps.clock.date();
    await deps.writer.replaceAll(deps.seeds.map((seed) => courierFromSeed(seed, at)));
    return {
      markets: new Set(deps.seeds.map((seed) => seed.marketId)).size,
      couriers: deps.seeds.length,
    };
  };
}

/** Veri hatasini yazimdan once ve TEK TEK soyler (hangi kurye, neden). */
export function assertValidSeeds(seeds: readonly CourierSeed[]): void {
  const seen = new Set<string>();
  for (const seed of seeds) {
    if (!isId(ID_PREFIX.COURIER, seed.id)) {
      throw AppError.validation('Gecersiz kurye kimligi', { details: { courierId: seed.id } });
    }
    if (!marketIdSchema.safeParse(seed.marketId).success) {
      throw AppError.validation('Gecersiz market kimligi', {
        details: { courierId: seed.id, marketId: seed.marketId },
      });
    }
    if (seed.name.trim() === '') {
      throw AppError.validation('Kurye adi bos', { details: { courierId: seed.id } });
    }
    if (!geoPointSchema.safeParse(seed.location).success) {
      throw AppError.validation('Gecersiz konum', { details: { courierId: seed.id } });
    }
    if (seen.has(seed.id)) {
      throw AppError.validation('Ayni kurye iki kez', { details: { courierId: seed.id } });
    }
    seen.add(seed.id);
  }
}
