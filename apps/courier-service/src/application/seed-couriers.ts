/**
 * Use-case: demo kuryelerini ve market konumu kopyasini bastan yazar (T13.1;
 * havuz ve markets T13.2).
 *
 * Yazmadan ONCE veri dogrulanir: bicimi bozuk kimlik, yinelenen kurye ya da
 * market, bos ad ya da gecersiz konum yazimi durdurur. Yanlis veri yarim
 * yazilmaz; yazim tek transaction'dadir (writer).
 *
 * Tekrar kosmak kuryeleri IDLE'a ve seed konumlarina dondurur (demo
 * sifirlamasi): atanmis kuryeler de bosa cikar. production'da REDDEDER.
 */

import { geoPointSchema, marketIdSchema } from '@getir/contracts';
import { AppError, ID_PREFIX, isId } from '@getir/core';
import type { Clock } from '@getir/core';

import type { CourierSeedWriter } from '../domain/courier-repository.js';
import { courierFromSeed } from '../domain/courier-seed.js';
import type { CourierSeed } from '../domain/courier-seed.js';
import type { MarketLocation } from '../domain/market-locator.js';

export interface SeedCouriersDeps {
  readonly writer: CourierSeedWriter;
  readonly seeds: readonly CourierSeed[];
  /** Market konumu kopyasi (havuzun merkezi; catalog'un demo verisiyle ayni). */
  readonly markets: readonly MarketLocation[];
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
    assertValidMarkets(deps.markets);
    const at = deps.clock.date();
    await deps.writer.replaceAll(
      deps.seeds.map((seed) => courierFromSeed(seed, at)),
      deps.markets,
    );
    return { markets: deps.markets.length, couriers: deps.seeds.length };
  };
}

/** Veri hatasini yazimdan once ve TEK TEK soyler (hangi kurye, neden). */
export function assertValidSeeds(seeds: readonly CourierSeed[]): void {
  const seen = new Set<string>();
  for (const seed of seeds) {
    if (!isId(ID_PREFIX.COURIER, seed.id)) {
      throw AppError.validation('Gecersiz kurye kimligi', { details: { courierId: seed.id } });
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

/** Market konumlari: kimlik bicimi, konum, tekillik. */
export function assertValidMarkets(markets: readonly MarketLocation[]): void {
  const seen = new Set<string>();
  for (const market of markets) {
    if (!marketIdSchema.safeParse(market.marketId).success) {
      throw AppError.validation('Gecersiz market kimligi', {
        details: { marketId: market.marketId },
      });
    }
    if (!geoPointSchema.safeParse(market.location).success) {
      throw AppError.validation('Gecersiz market konumu', {
        details: { marketId: market.marketId },
      });
    }
    if (seen.has(market.marketId)) {
      throw AppError.validation('Ayni market iki kez', { details: { marketId: market.marketId } });
    }
    seen.add(market.marketId);
  }
}
