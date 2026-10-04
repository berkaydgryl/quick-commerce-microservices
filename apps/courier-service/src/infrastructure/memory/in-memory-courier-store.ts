/**
 * Bellek deposu: MOCK modu ve testler. Mongo uygulamasiyla AYNI sozlesmeden
 * gecer: havuz ve sira (domain/courier-pool.ts; mesafe haversine, Mongo
 * $geoNear) ve "bir siparisi en fazla bir kurye tasir" kurali (Mongo'da
 * benzersiz indeks, burada acik denetim; ikisi de CONFLICT). Islemler senkron
 * oldugu icin her adim kendiliginden atomiktir.
 */

import { AppError } from '@getir/core';

import { COURIER_STATUS } from '../../domain/courier.js';
import type { Courier, GeoPoint } from '../../domain/courier.js';
import { comparePoolCandidates, isWithinPool } from '../../domain/courier-pool.js';
import type { PoolCandidate } from '../../domain/courier-pool.js';
import type {
  CourierRepository,
  CourierSeedWriter,
  NearestClaimRequest,
} from '../../domain/courier-repository.js';
import { distanceMeters } from '../../domain/geo.js';
import type { MarketLocation, MarketLocator } from '../../domain/market-locator.js';

export class InMemoryCourierStore implements CourierRepository, CourierSeedWriter, MarketLocator {
  private readonly couriers = new Map<string, Courier>();
  private readonly markets = new Map<string, GeoPoint>();

  constructor(initial: readonly Courier[] = [], markets: readonly MarketLocation[] = []) {
    for (const courier of initial) {
      this.couriers.set(courier.id, courier);
    }
    for (const market of markets) {
      this.markets.set(market.marketId, market.location);
    }
  }

  findById(id: string): Promise<Courier | null> {
    return Promise.resolve(this.couriers.get(id) ?? null);
  }

  findByOrder(orderId: string): Promise<Courier | null> {
    return Promise.resolve(this.carrierOf(orderId));
  }

  claimNearest({ orderId, near, rule, at }: NearestClaimRequest): Promise<Courier | null> {
    const candidate = [...this.couriers.values()]
      .filter((courier) => courier.status === COURIER_STATUS.IDLE)
      .map((courier): PoolCandidate => ({
        courier,
        distanceMeters: distanceMeters(near, courier.lastLocation),
      }))
      .filter((entry) => isWithinPool(entry.distanceMeters, rule))
      .sort((left, right) => comparePoolCandidates(left, right, rule.bandMeters))[0];
    if (candidate === undefined) {
      return Promise.resolve(null);
    }
    if (this.carrierOf(orderId) !== null) {
      return Promise.reject(
        AppError.conflict('Kayit zaten var', { details: { fields: ['currentOrderId'] } }),
      );
    }
    const { idleSince: _busy, ...rest } = candidate.courier;
    const claimed: Courier = {
      ...rest,
      status: COURIER_STATUS.BUSY,
      currentOrderId: orderId,
      lastAssignedAt: at,
    };
    this.couriers.set(claimed.id, claimed);
    return Promise.resolve(claimed);
  }

  releaseByOrder(orderId: string, at: Date): Promise<Courier | null> {
    const carrier = this.carrierOf(orderId);
    if (carrier === null) {
      return Promise.resolve(null);
    }
    const { currentOrderId: _released, ...rest } = carrier;
    const released: Courier = { ...rest, status: COURIER_STATUS.IDLE, idleSince: at };
    this.couriers.set(released.id, released);
    return Promise.resolve(released);
  }

  locate(marketId: string): Promise<GeoPoint | null> {
    return Promise.resolve(this.markets.get(marketId) ?? null);
  }

  replaceAll(couriers: readonly Courier[], markets: readonly MarketLocation[]): Promise<void> {
    this.couriers.clear();
    for (const courier of couriers) {
      this.couriers.set(courier.id, courier);
    }
    this.markets.clear();
    for (const market of markets) {
      this.markets.set(market.marketId, market.location);
    }
    return Promise.resolve();
  }

  private carrierOf(orderId: string): Courier | null {
    for (const courier of this.couriers.values()) {
      if (courier.currentOrderId === orderId) {
        return courier;
      }
    }
    return null;
  }
}
