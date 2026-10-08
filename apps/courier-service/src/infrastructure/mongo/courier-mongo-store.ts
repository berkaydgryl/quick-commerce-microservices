/**
 * CourierRepository ve MarketLocator'in Mongo uygulamasi. Sorgu yazmaz
 * (couriers-collection.ts, markets-collection.ts); bellek deposuyla ayni
 * sozlesme testinden gecer.
 */

import { COURIER_CLAIM_CANDIDATES } from '../../config/constants.js';
import type { Courier, GeoPoint } from '../../domain/courier.js';
import type {
  CarrierReader,
  CourierBatchReader,
  CourierRepository,
  NearestClaimRequest,
  ReleaseOptions,
} from '../../domain/courier-repository.js';
import type { MarketLocator } from '../../domain/market-locator.js';
import type { CouriersCollection } from './couriers-collection.js';
import type { CourierDocument } from './documents.js';
import { fromCourierDocument, fromGeoJson, toGeoJson } from './mappers.js';
import type { MarketsCollection } from './markets-collection.js';

const toCourier = (document: CourierDocument | null): Courier | null =>
  document === null ? null : fromCourierDocument(document);

/** Atomik talebin ayari; testler kucultebilir. */
export interface ClaimTuning {
  /** Bir okumada en fazla kac aday. */
  readonly candidates: number;
}

export class CourierMongoStore
  implements CourierRepository, CourierBatchReader, CarrierReader, MarketLocator
{
  constructor(
    private readonly couriers: CouriersCollection,
    private readonly markets: MarketsCollection,
    private readonly tuning: ClaimTuning = { candidates: COURIER_CLAIM_CANDIDATES },
  ) {}

  async findById(id: string): Promise<Courier | null> {
    return toCourier(await this.couriers.findById(id));
  }

  async findByOrder(orderId: string): Promise<Courier | null> {
    return toCourier(await this.couriers.findByOrder(orderId));
  }

  async listCarrying(limit: number, afterOrderId?: string): Promise<readonly Courier[]> {
    return (await this.couriers.findCarrying(limit, afterOrderId)).map(fromCourierDocument);
  }

  async findByIds(ids: readonly string[]): Promise<readonly Courier[]> {
    return (await this.couriers.findByIds(ids)).map(fromCourierDocument);
  }

  /**
   * Sira kuralina gore adaylari okur ve sirayla KOSULLU alir (B7): aday o arada
   * baska siparise gittiyse siradakine gecer. Kaybedilen adaylar sonraki
   * okumada DISLANIR; liste bosalana kadar denenir. Her okuma en az bir adayi
   * tuketir, yani deneme sayisinin ust siniri havuzun buyuklugudur. null
   * yalnizca "havuzda bos kurye kalmadi" demektir (bellek deposuyla ayni).
   * Yogun eszamanlilikta butun istekler ayni ilk adaylari okur; sabit tur
   * sinirli surum bos kurye varken NOT_FOUND donuyordu (QA O1).
   */
  async claimNearest({ orderId, near, rule, at }: NearestClaimRequest): Promise<Courier | null> {
    const lost: string[] = [];
    for (;;) {
      const candidates = await this.couriers.poolCandidates(
        near,
        rule,
        this.tuning.candidates,
        lost,
      );
      if (candidates.length === 0) {
        return null;
      }
      for (const courierId of candidates) {
        const claimed = await this.couriers.claimIfIdle(courierId, orderId, at);
        if (claimed !== null) {
          return fromCourierDocument(claimed);
        }
        lost.push(courierId);
      }
    }
  }

  async releaseByOrder(
    orderId: string,
    at: Date,
    options: ReleaseOptions = {},
  ): Promise<Courier | null> {
    const { location, courierId } = options;
    return toCourier(
      await this.couriers.releaseByOrder(orderId, at, {
        ...(location === undefined ? {} : { location: toGeoJson(location) }),
        ...(courierId === undefined ? {} : { courierId }),
      }),
    );
  }

  async locate(marketId: string): Promise<GeoPoint | null> {
    const market = await this.markets.findById(marketId);
    return market === null ? null : fromGeoJson(market.location);
  }
}
