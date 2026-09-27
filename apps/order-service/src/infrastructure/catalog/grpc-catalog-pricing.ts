/**
 * CatalogPricing portunun gRPC uygulamasi: order -> catalog (T7.2).
 *
 * Tasima isi service-kit callUnary'dedir (requestId iletimi, sure siniri, hata
 * cevirisi); burasi yalnizca proto <-> domain cevirisini yapar. Istemci
 * baglantisi uzun omurludur ve kapanista close() ile birakilir.
 */

import { AppError, CURRENCY } from '@getir/core';
import type { PricingRules } from '@getir/pricing';
import { catalogV1, commonV1 } from '@getir/proto';
import { callUnary } from '@getir/service-kit';
import { credentials } from '@grpc/grpc-js';

import type { CatalogPricing } from '../../application/catalog-pricing.js';
import type { RequestScope } from '../../application/request-scope.js';
import { ITEM_UNIT } from '../../domain/order-item.js';
import type { ItemUnit } from '../../domain/order-item.js';
import type { CatalogOffer } from '../../domain/price-draft.js';

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
  ) {
    // TLS YOK: servisler yalnizca ic agda konusur (gateway havuzuyla ayni karar).
    this.client = new catalogV1.CatalogServiceClient(address, credentials.createInsecure());
  }

  async marketRules(marketId: string, scope: RequestScope): Promise<PricingRules> {
    const response = await callUnary<catalogV1.GetMarketRequest, catalogV1.GetMarketResponse>(
      (request, metadata, options, callback) =>
        this.client.getMarket(request, metadata, options, callback),
      { marketId },
      { requestId: scope.requestId, timeoutMs: this.timeoutMs },
    );

    const rules = response.market?.pricingRules;
    if (rules === undefined) {
      throw AppError.internal('Catalog market kurallarini dondurmedi', { details: { marketId } });
    }
    return {
      minBasketMinor: minorOf(rules.minBasket, 'minBasket'),
      deliveryFeeMinor: minorOf(rules.deliveryFee, 'deliveryFee'),
      freeDeliveryThresholdMinor: minorOf(rules.freeDeliveryThreshold, 'freeDeliveryThreshold'),
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
      { requestId: scope.requestId, timeoutMs: this.timeoutMs },
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
