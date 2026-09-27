/**
 * Taslak siparisin fiyatlandirmasi (T7.2): SAF kural, I/O yok.
 *
 * Girdiler catalog'dan okunmus teklifler ve marketin kurallaridir; hesap web
 * sepetinin kullandigi @getir/pricing calculateCart'tir, boylece iki taraf
 * AYNI toplami bulur. Kontrol sirasi: urunler o markette satista mi -> kupon
 * gecerli mi -> minimum sepet -> istemcinin gordugu toplam tutuyor mu.
 * Her basarisizlik AppError'dur; taslak ACILMAZ.
 */

import { AppError, ERROR_CODES } from '@getir/core';
import type { PricingRules } from '@getir/pricing';
import { calculateCart, normalizeCouponCode } from '@getir/pricing';

import type { ItemUnit, OrderItem, OrderPricing } from './order-item.js';

/** Sepetten gelen ham satir. FIYAT TASIMAZ (istemcinin fiyatina guvenilmez). */
export interface CartLine {
  readonly productId: string;
  readonly sku: string;
  readonly quantity: number;
}

/** Catalog'da o markette SATISTA olan teklif; fiyat catalog'un soyledigidir. */
export interface CatalogOffer {
  readonly productId: string;
  readonly sku: string;
  readonly name: string;
  readonly unit: ItemUnit;
  readonly unitPriceMinor: number;
  readonly currency: string;
}

export interface DraftPricingInput {
  readonly lines: readonly CartLine[];
  readonly offers: readonly CatalogOffer[];
  readonly rules: PricingRules;
  readonly isFirstOrder: boolean;
  readonly couponCode?: string | undefined;
}

export interface PricedDraft {
  readonly items: readonly OrderItem[];
  readonly pricing: OrderPricing;
}

/**
 * Satirlari catalog fiyatiyla kaleme cevirir ve tutari hesaplar.
 *
 * @throws AppError VALIDATION_FAILED - urun o markette satista degil ya da sku uyusmuyor
 * @throws AppError COUPON_INVALID - kupon uygulanamadi (ayrintida sebep)
 * @throws AppError MIN_BASKET_NOT_MET - ara toplam minimum sepetin altinda (ayrintida eksik tutar)
 */
export function priceDraft(input: DraftPricingInput): PricedDraft {
  const items = toOrderItems(input.lines, input.offers);
  const totals = calculateCart({
    lines: items.map(({ productId, unitPriceMinor, quantity }) => ({
      productId,
      unitPriceMinor,
      quantity,
    })),
    rules: input.rules,
    context: { isFirstOrder: input.isFirstOrder },
    couponCode: input.couponCode,
  });

  if (totals.coupon !== null && !totals.coupon.applied) {
    throw new AppError(ERROR_CODES.COUPON_INVALID, 'Kupon uygulanamadi', {
      details: { couponCode: totals.coupon.code, reason: totals.coupon.reason },
    });
  }
  if (!totals.canCheckout) {
    throw new AppError(ERROR_CODES.MIN_BASKET_NOT_MET, 'Minimum sepet tutarina ulasilmadi', {
      details: {
        amountToMinBasketMinor: totals.amountToMinBasketMinor,
        minBasketMinor: input.rules.minBasketMinor,
      },
    });
  }

  const couponCode =
    totals.coupon?.applied === true ? normalizeCouponCode(totals.coupon.code) : undefined;
  return {
    items,
    pricing: {
      currency: currencyOf(items, input.offers),
      subtotalMinor: totals.subtotalMinor,
      deliveryFeeMinor: totals.deliveryFeeMinor,
      discountMinor: totals.discountMinor,
      totalMinor: totals.totalMinor,
      ...(couponCode === undefined ? {} : { couponCode }),
    },
  };
}

/**
 * Istemcinin ekranda gordugu toplam, sunucunun hesabiyla ayni mi?
 *
 * @throws AppError PRICE_CHANGED - ayrintida yeni toplam; istemci "fiyat
 *   degisti, yeni tutar X" diyebilsin.
 */
export function assertExpectedTotal(pricing: OrderPricing, expectedTotalMinor: number): void {
  if (pricing.totalMinor !== expectedTotalMinor) {
    throw new AppError(ERROR_CODES.PRICE_CHANGED, 'Sepet tutari degisti', {
      details: {
        expectedTotalMinor,
        totalMinor: pricing.totalMinor,
        currency: pricing.currency,
      },
    });
  }
}

/** Satirlari tekliflerle eslestirir; eslesmeyen her urun TEK hatada listelenir. */
function toOrderItems(
  lines: readonly CartLine[],
  offers: readonly CatalogOffer[],
): readonly OrderItem[] {
  const byProduct = new Map(offers.map((offer) => [offer.productId, offer]));
  const unavailable = lines
    .filter((line) => !byProduct.has(line.productId))
    .map((line) => line.productId);
  const skuMismatch = lines
    .filter((line) => {
      const offer = byProduct.get(line.productId);
      return offer !== undefined && offer.sku !== line.sku;
    })
    .map((line) => line.productId);

  if (unavailable.length > 0 || skuMismatch.length > 0) {
    throw AppError.validation('Sepetteki bazi urunler bu markette satista degil', {
      details: {
        ...(unavailable.length === 0 ? {} : { unavailableProductIds: unavailable }),
        ...(skuMismatch.length === 0 ? {} : { skuMismatchProductIds: skuMismatch }),
      },
    });
  }

  return lines.map((line) => {
    const offer = byProduct.get(line.productId);
    if (offer === undefined) {
      // Yukarida elendi; tip daraltmasi icin.
      throw AppError.internal('Teklif eslestirmesi tutarsiz', {
        details: { productId: line.productId },
      });
    }
    return {
      productId: offer.productId,
      sku: offer.sku,
      name: offer.name,
      unit: offer.unit,
      quantity: line.quantity,
      unitPriceMinor: offer.unitPriceMinor,
      lineTotalMinor: offer.unitPriceMinor * line.quantity,
    };
  });
}

/** Siparisin tek para birimi; catalog'dan farkli birim gelirse veri hatasidir. */
function currencyOf(items: readonly OrderItem[], offers: readonly CatalogOffer[]): string {
  const used = new Set(
    offers
      .filter((offer) => items.some((item) => item.productId === offer.productId))
      .map((offer) => offer.currency),
  );
  const [currency] = used;
  if (used.size !== 1 || currency === undefined) {
    throw AppError.internal('Tekliflerin para birimi tutarsiz', {
      details: { currencies: [...used] },
    });
  }
  return currency;
}
