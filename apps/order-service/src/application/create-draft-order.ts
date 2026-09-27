/**
 * Use-case: sepeti fiyatlandirip taslak siparise cevirir (T7.2).
 *
 * Tutar istemciye GUVENILMEDEN sunucuda hesaplanir: market kurallari ve
 * teklif fiyatlari catalog'dan okunur, hesap web sepetiyle ayni fonksiyondur
 * (@getir/pricing). Istemcinin gordugu toplam tutmazsa PRICE_CHANGED doner ve
 * taslak ACILMAZ. Fiyat taslakta DONDURULUR; CreateOrder yeniden hesaplamaz.
 *
 * KAPSAM DISI: risk degerlendirmesi ve odeme (T7.1 saga), stok rezervasyonu
 * (Gun 9-11), kapali market kontrolu (T11.4).
 */

import type { Clock } from '@getir/core';

import type { OrderHistoryReader } from '../domain/order-history-reader.js';
import type { OrderRepository } from '../domain/order-repository.js';
import type { DeliveryLocation, Order } from '../domain/order.js';
import { createDraftOrder as buildDraftOrder } from '../domain/order.js';
import type { CartLine } from '../domain/price-draft.js';
import { assertExpectedTotal, priceDraft } from '../domain/price-draft.js';
import type { CatalogPricing } from './catalog-pricing.js';
import type { RequestScope } from './request-scope.js';

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

export interface CreateDraftOrderDeps {
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
    const [rules, offers, isFirstOrder] = await Promise.all([
      deps.catalog.marketRules(input.marketId, scope),
      deps.catalog.activeOffers(input.marketId, productIds, scope),
      input.couponCode === undefined
        ? Promise.resolve(false)
        : deps.history.hasPaidOrder(input.userId).then((paidBefore) => !paidBefore),
    ]);

    const { items, pricing } = priceDraft({
      lines: input.lines,
      offers,
      rules,
      isFirstOrder,
      couponCode: input.couponCode,
    });
    assertExpectedTotal(pricing, input.expectedTotalMinor);

    const order = buildDraftOrder(
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
    await deps.repository.insert(order);
    return order;
  };
}
