import type { Market } from '../../domain/catalog.js';
import type { GeoPoint } from '../../domain/geo.js';
import { distanceMeters } from '../../domain/geo.js';
import type { MarketDistance } from '../../domain/market-coverage.js';
import type { MarketReader } from '../../domain/market-reader.js';

export class InMemoryMarketReader implements MarketReader {
  private readonly markets: readonly Market[];
  private readonly byId: ReadonlyMap<string, Market>;

  constructor(markets: readonly Market[]) {
    this.markets = markets;
    this.byId = new Map(markets.map((market) => [market.id, market]));
  }

  getMarket(marketId: string): Promise<Market | null> {
    return Promise.resolve(this.byId.get(marketId) ?? null);
  }

  marketExists(marketId: string): Promise<boolean> {
    return Promise.resolve(this.byId.has(marketId));
  }

  /** Mongo'daki $geoNear'in karsiligi: mesafe hesabi + siralama + sinir. */
  listMarketsByDistance(point: GeoPoint, limit: number): Promise<readonly MarketDistance[]> {
    const ranked = this.markets
      .map((market) => ({ market, distanceMeters: distanceMeters(point, market) }))
      .sort((left, right) => left.distanceMeters - right.distanceMeters)
      .slice(0, limit);
    return Promise.resolve(ranked);
  }
}
