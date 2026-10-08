/**
 * Use-case: sepeti fiyatlandirip taslak siparise cevirir (T7.2).
 *
 * Tutar istemciye GUVENILMEDEN sunucuda hesaplanir: market kurallari ve
 * teklif fiyatlari catalog'dan okunur, hesap web sepetiyle ayni fonksiyondur
 * (@getir/pricing). Istemcinin gordugu toplam tutmazsa PRICE_CHANGED doner ve
 * taslak ACILMAZ. Fiyat taslakta DONDURULUR; CreateOrder yeniden hesaplamaz.
 *
 * Stok taslak acilirken KILITLENIR (T11.2, draft-reservation.ts): kilitli taslak
 * tek yazimda kaydedilir; yazim basarisiz olursa kilit hemen geri verilir.
 *
 * Kapali market (#154) taslak ACMAZ: NO_STORE + sebep STORE_CLOSED, fiyatlamadan
 * ve stok kilidinden ONCE (stoga dokunulmaz; kullanicinin baska marketteki
 * kilidi etkilenmez). Teslimat adresi marketin yaricapi disindaysa (#203) ayni
 * yerde, kapali market denetiminden SONRA: NO_STORE + sebep OUT_OF_RANGE.
 * CreateOrder marketi yeniden okumaz: kilit suresi icinde kapanan markette
 * siparis kabul edilir.
 *
 * KAPSAM DISI: risk degerlendirmesi ve odeme (T7.1 saga), banda gore kilit
 * suresi (T11.3).
 */

import type { Clock } from '@getir/core';

import { orderCreatedEvents } from '../domain/order-events.js';
import type { OrderHistoryReader } from '../domain/order-history-reader.js';
import type { OrderRepository } from '../domain/order-repository.js';
import type { DeliveryLocation, Order } from '../domain/order.js';
import { assertMarketOpen, deliveryReach, outOfDeliveryRange } from '../domain/market-terms.js';
import { createDraftOrder as buildDraftOrder } from '../domain/order.js';
import { RELEASE_REASON } from '../domain/stock-reservation.js';
import type { CartLine } from '../domain/price-draft.js';
import { assertExpectedTotal, priceDraft } from '../domain/price-draft.js';
import type { CatalogPricing } from './catalog-pricing.js';
import { reserveDraftStock } from './draft-reservation.js';
import type { DraftReservationDeps } from './draft-reservation.js';
import type { RequestScope } from './request-scope.js';
import { releaseStock } from './stock-step.js';

export interface CreateDraftOrderInput {
  readonly userId: string;
  readonly marketId: string;
  readonly lines: readonly CartLine[];
  readonly deliveryLocation: DeliveryLocation;
  readonly deliveryAddress: string;
  /** Kullanicinin ekranda gordugu toplam (kurus). */
  readonly expectedTotalMinor: number;
  readonly couponCode?: string | undefined;
}

export interface CreateDraftOrderDeps extends DraftReservationDeps {
  readonly repository: OrderRepository;
  readonly history: Pick<OrderHistoryReader, 'hasPaidOrder'>;
  readonly catalog: CatalogPricing;
  readonly clock: Clock;
}

export type CreateDraftOrder = (
  input: CreateDraftOrderInput,
  scope: RequestScope,
) => Promise<Order>;

export function createCreateDraftOrder(deps: CreateDraftOrderDeps): CreateDraftOrder {
  return async (input, scope) => {
    const productIds = [...new Set(input.lines.map((line) => line.productId))];

    // Uc okuma birbirinden bagimsiz: paralel. "Ilk siparis mi" sorusu yalnizca
    // kupon girildiyse sorulur; kuponsuz sepette sonucu hicbir seyi degistirmez.
    const marketRead = deps.catalog.marketRules(input.marketId, scope);
    const otherReads = Promise.all([
      deps.catalog.activeOffers(input.marketId, productIds, scope),
      input.couponCode === undefined
        ? Promise.resolve(false)
        : deps.history.hasPaidOrder(input.userId).then((paidBefore) => !paidBefore),
    ]);
    // Asagida once market beklenir; erken hatada diger okumanin reddi islenmemis kalmasin.
    otherReads.catch(() => undefined);
    // Kapali market her seyden once (#154): teklif ve gecmis okumasinin hatasindan,
    // fiyat ve stok hatalarindan once gelir.
    const market = await marketRead;
    assertMarketOpen(market);
    const reach = deliveryReach(market, input.deliveryLocation);
    if (reach.outside) {
      // Istemciye mesafe yankilanmaz; sinir uyusmazligini (Mongo +-1 m) ya da bozuk
      // catalog verisini ayirt etmek icin gunlukte. Koordinat YAZILMAZ.
      scope.logger.info(
        {
          marketId: input.marketId,
          distanceMeters: Math.round(reach.distanceMeters),
          radiusMeters: market.deliveryRadiusMeters,
        },
        'teslimat adresi yaricap disinda',
      );
      throw outOfDeliveryRange();
    }
    const [offers, isFirstOrder] = await otherReads;

    const { items, pricing } = priceDraft({
      lines: input.lines,
      offers,
      rules: market.rules,
      isFirstOrder,
      couponCode: input.couponCode,
    });
    assertExpectedTotal(pricing, input.expectedTotalMinor);

    const draft = buildDraftOrder(
      {
        userId: input.userId,
        marketId: input.marketId,
        items,
        pricing,
        deliveryLocation: input.deliveryLocation,
        deliveryAddress: input.deliveryAddress,
      },
      deps.clock,
    );
    const order = await reserveDraftStock(deps, draft, scope);
    try {
      // Taslak, kilidi ve order.created ayni atomik yazimda (ADR-04).
      await deps.repository.insert(order, orderCreatedEvents(order));
    } catch (error: unknown) {
      await releaseStock(deps, order, RELEASE_REASON.DRAFT_NOT_SAVED, scope);
      throw error;
    }
    return order;
  };
}
