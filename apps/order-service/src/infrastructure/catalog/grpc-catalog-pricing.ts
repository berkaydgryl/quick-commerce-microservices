/**
 * CatalogPricing portunun gRPC uygulamasi: order -> catalog (T7.2).
 *
 * Tasima isi service-kit callUnary'dedir (requestId iletimi, sure siniri, hata
 * cevirisi); burasi yalnizca proto <-> domain cevirisini yapar. Istemci
 * baglantisi uzun omurludur ve kapanista close() ile birakilir.
 */

import { AppError, CURRENCY } from '@getir/core';
import { catalogV1, commonV1 } from '@getir/proto';
import { callUnary } from '@getir/service-kit';
import { credentials } from '@grpc/grpc-js';

import type { CatalogPricing } from '../../application/catalog-pricing.js';
import type { RequestScope } from '../../application/request-scope.js';
import type { MarketTerms } from '../../domain/market-terms.js';
import { ITEM_UNIT } from '../../domain/order-item.js';
import type { ItemUnit } from '../../domain/order-item.js';
import type { CatalogOffer } from '../../domain/price-draft.js';
import { IDEMPOTENT, outgoingOptions } from '../grpc-resilience.js';
import type { ClientResilience } from '../grpc-resilience.js';

const UNIT_FROM_PROTO: Readonly<Record<commonV1.Unit, ItemUnit>> = {
  [commonV1.Unit.UNIT_UNSPECIFIED]: ITEM_UNIT.UNSPECIFIED,
  [commonV1.Unit.UNIT_PIECE]: ITEM_UNIT.PIECE,
  [commonV1.Unit.UNIT_KILOGRAM]: ITEM_UNIT.KILOGRAM,
  [commonV1.Unit.UNIT_LITER]: ITEM_UNIT.LITER,
  [commonV1.Unit.UNIT_PACK]: ITEM_UNIT.PACK,
  [commonV1.Unit.UNRECOGNIZED]: ITEM_UNIT.UNSPECIFIED,
};

export class GrpcCatalogPricing implements CatalogPricing {
  private readonly client: catalogV1.CatalogServiceClient;

  constructor(
    address: string,
    private readonly timeoutMs: number,
    private readonly resilience: ClientResilience = {},
  ) {
    // TLS YOK: servisler yalnizca ic agda konusur (gateway havuzuyla ayni karar).
    this.client = new catalogV1.CatalogServiceClient(address, credentials.createInsecure());
  }

  async marketRules(marketId: string, scope: RequestScope): Promise<MarketTerms> {
    const response = await callUnary<catalogV1.GetMarketRequest, catalogV1.GetMarketResponse>(
      (request, metadata, options, callback) =>
        this.client.getMarket(request, metadata, options, callback),
      { marketId },
      // Okuma: yeniden denenebilir (D17).
      outgoingOptions(scope, this.timeoutMs, this.resilience, IDEMPOTENT),
    );

    const market = response.market;
    if (market === undefined) {
      throw AppError.internal('Catalog marketi dondurmedi', { details: { marketId } });
    }
    // Kapali marketin kurallari okunmaz (#154): kural verisi bozuk olsa da cevap
    // NO_STORE olur, 500 degil. proto3: alan yoksa false (kapali); catalog her
    // markette yazar.
    if (!market.isOpen) {
      return { isOpen: false };
    }
    const rules = market.pricingRules;
    if (rules === undefined) {
      throw AppError.internal('Catalog market kurallarini dondurmedi', { details: { marketId } });
    }
    // Konum ya da yaricap bozuksa catalog verisi bozuk (2dsphere indeksi konum
    // ister; proto3 int32'de eksik yaricap 0 gelir): "yaricap disi" diye sessiz ret
    // yok, 500 + gunluk (#203).
    const location = market.location;
    if (
      location === undefined ||
      !Number.isFinite(location.lat) ||
      !Number.isFinite(location.lng)
    ) {
      throw AppError.internal('Catalog market konumunu dondurmedi', { details: { marketId } });
    }
    if (!Number.isFinite(market.deliveryRadiusMeters) || market.deliveryRadiusMeters <= 0) {
      throw AppError.internal('Catalog market yaricapi gecersiz', { details: { marketId } });
    }
    return {
      isOpen: true,
      location: { lat: location.lat, lng: location.lng },
      deliveryRadiusMeters: market.deliveryRadiusMeters,
      rules: {
        minBasketMinor: minorOf(rules.minBasket, 'minBasket'),
        deliveryFeeMinor: minorOf(rules.deliveryFee, 'deliveryFee'),
        freeDeliveryThresholdMinor: minorOf(rules.freeDeliveryThreshold, 'freeDeliveryThreshold'),
      },
    };
  }

  async activeOffers(
    marketId: string,
    productIds: readonly string[],
    scope: RequestScope,
  ): Promise<readonly CatalogOffer[]> {
    const response = await callUnary<
      catalogV1.BatchGetOffersRequest,
      catalogV1.BatchGetOffersResponse
    >(
      (request, metadata, options, callback) =>
        this.client.batchGetOffers(request, metadata, options, callback),
      { marketId, productIds: [...productIds] },
      // Okuma: yeniden denenebilir (D17).
      outgoingOptions(scope, this.timeoutMs, this.resilience, IDEMPOTENT),
    );

    // catalog zaten yalnizca aktif teklifi `offers`a koyar (T9.3); filtre,
    // sozlesmeyi ikinci kez varsaymamak icin.
    return response.offers.filter((offer) => offer.isActive).map(toCatalogOffer);
  }

  /** Kapanista cagrilir: acik HTTP/2 baglantisi process'i ayakta tutmasin. */
  close(): void {
    this.client.close();
  }
}

function toCatalogOffer(offer: catalogV1.Offer): CatalogOffer {
  if (offer.price === undefined) {
    throw AppError.internal('Catalog teklifi fiyatsiz dondu', {
      details: { productId: offer.productId },
    });
  }
  return {
    productId: offer.productId,
    sku: offer.sku,
    name: offer.name,
    unit: UNIT_FROM_PROTO[offer.unit],
    unitPriceMinor: offer.price.amountMinor,
    // proto Money: bos para birimi tek birim (CURRENCY) sayilir.
    currency: offer.price.currency === '' ? CURRENCY : offer.price.currency,
  };
}

function minorOf(money: commonV1.Money | undefined, field: string): number {
  if (money === undefined) {
    throw AppError.internal('Catalog market kurali eksik', { details: { field } });
  }
  return money.amountMinor;
}
