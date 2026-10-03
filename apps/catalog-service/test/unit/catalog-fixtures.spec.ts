/**
 * Pazaryeri demo verisinin butunlugu (ADR-15). Seed ve MOCK modu bu veriyi
 * kullanir; burada bir hata ya seed'i (benzersiz indeks ihlali) ya da istemciyi
 * (bos market sayfasi, yanlis fiyat) bozar.
 */

import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import type { StoreType } from '../../src/domain/catalog.js';
import { offerIdFor, STORE_TYPE } from '../../src/domain/catalog.js';
import { CATALOG_SNAPSHOT } from '../../src/infrastructure/fixtures.js';
import { EXPECTED_NEARBY } from '../support/demo-addresses.js';

const { categories, products, markets, offers } = CATALOG_SNAPSHOT;

function duplicates(values: readonly string[]): string[] {
  return values.filter((value, index) => values.indexOf(value) !== index);
}

/**
 * Dukkan turunun satabilecegi kategoriler (T11.11). Genel market her seyi
 * satar; sarkuteri peynir-zeytin yaninda sucuk ve pastirma da satar.
 */
const STORE_CATEGORIES: Readonly<Record<StoreType, 'ALL' | readonly string[]>> = {
  MARKET: 'ALL',
  MANAV: ['cat_meyve-sebze'],
  KASAP: ['cat_et-tavuk'],
  SARKUTERI: ['cat_sut-kahvaltilik', 'cat_et-tavuk'],
  KURUYEMIS: ['cat_atistirmalik'],
  FIRIN: ['cat_firindan'],
  PETSHOP: ['cat_evcil-hayvan'],
  CICEKCI: ['cat_ev-yasam'],
};

/** @getir/contracts kimlik bicimi: onek + kucuk harf/rakam/tekli tire. */
const CATALOG_ID = (prefix: string) => new RegExp(`^${prefix}_[a-z0-9]+(?:-[a-z0-9]+)*$`);

describe('pazaryeri demo verisi', () => {
  it('13 kategori, 49 ortak urun, 21 market (roadmap tablosu)', () => {
    expect(categories).toHaveLength(13);
    expect(products).toHaveLength(49);
    expect(markets).toHaveLength(21);
  });

  it('kimlikler sozlesmedeki onekli bicimde (ADR-15)', () => {
    categories.forEach((category) => expect(category.id).toMatch(CATALOG_ID('cat')));
    products.forEach((product) => expect(product.id).toMatch(CATALOG_ID('prd')));
    markets.forEach((market) => expect(market.id).toMatch(CATALOG_ID('mkt')));
    offers.forEach((offer) =>
      expect(offerIdFor(offer.marketId, offer.productId)).toMatch(CATALOG_ID('ofr')),
    );
  });

  it('benzersiz alanlar gercekten benzersiz (seed indeks ihlaliyle dusmesin)', () => {
    expect(duplicates(categories.map((category) => category.slug))).toEqual([]);
    expect(duplicates(products.map((product) => product.id))).toEqual([]);
    expect(duplicates(products.map((product) => product.sku))).toEqual([]);
    expect(duplicates(markets.map((market) => market.id))).toEqual([]);
    expect(duplicates(offers.map((offer) => `${offer.marketId}/${offer.productId}`))).toEqual([]);
  });

  it('her teklif var olan market ve urune isaret eder; her marketin teklifi var', () => {
    const marketIds = new Set(markets.map((market) => market.id));
    const productIds = new Set(products.map((product) => product.id));

    expect(
      offers.filter((offer) => !marketIds.has(offer.marketId) || !productIds.has(offer.productId)),
    ).toEqual([]);
    for (const market of markets) {
      expect(offers.some((offer) => offer.marketId === market.id)).toBe(true);
    }
  });

  it('her urun en az bir markette satilir; her kategorinin urunu var (T11.11)', () => {
    const offered = new Set(offers.map((offer) => offer.productId));
    const filled = new Set(products.map((product) => product.categoryId));

    expect(products.filter((product) => !offered.has(product.id))).toEqual([]);
    expect(categories.filter((category) => !filled.has(category.id))).toEqual([]);
  });

  it('her urunun kategorisi var', () => {
    const categoryIds = new Set(categories.map((category) => category.id));

    expect(products.filter((product) => !categoryIds.has(product.categoryId))).toEqual([]);
  });

  it('fiyat markete ozeldir: ayni urun en az iki markette farkli fiyatta', () => {
    const milkPrices = new Set(
      offers.filter((offer) => offer.productId === 'prd_sut-1l').map((offer) => offer.priceMinor),
    );

    expect(milkPrices.size).toBeGreaterThan(1);
  });

  it('tutarlar kurus cinsinden pozitif tam sayi (fiyat ve kurallar)', () => {
    const amounts = [
      ...offers.map((offer) => offer.priceMinor),
      // Alanlar ACIKCA: Object.values indeks imzasi olmayan tipte any[] dondurur.
      ...markets.flatMap(({ pricingRules }) => [
        pricingRules.minBasketMinor,
        pricingRules.deliveryFeeMinor,
        pricingRules.freeDeliveryThresholdMinor,
      ]),
    ];
    for (const amount of amounts) {
      expect(Number.isInteger(amount)).toBe(true);
      expect(amount).toBeGreaterThan(0);
    }
  });

  it('kurallar tutarli: ucretsiz teslimat esigi minimum sepetin ustunde', () => {
    for (const { pricingRules } of markets) {
      expect(pricingRules.freeDeliveryThresholdMinor).toBeGreaterThan(pricingRules.minBasketMinor);
    }
  });

  it('dukkan yalnizca turunun kategorilerini satar (manav meyve-sebze; T11.11)', () => {
    const categoryOf = new Map(products.map((product) => [product.id, product.categoryId]));
    const typeOf = new Map(markets.map((market) => [market.id, market.storeType]));
    const outOfType = offers.filter((offer) => {
      const allowed = STORE_CATEGORIES[typeOf.get(offer.marketId) ?? STORE_TYPE.MARKET];
      return allowed !== 'ALL' && !allowed.includes(categoryOf.get(offer.productId) ?? '');
    });

    expect(outOfType).toEqual([]);
  });

  it('Ev ve Is adresinde her dukkan turunden en az bir market var (sol menu bos kalmaz)', () => {
    const typeOf = new Map(markets.map((market) => [market.id, market.storeType]));
    for (const nearby of [EXPECTED_NEARBY.Ev, EXPECTED_NEARBY.İş]) {
      const types = new Set(nearby.map((entry) => typeOf.get(entry.marketId)));

      expect([...types].sort()).toEqual(Object.values(STORE_TYPE).sort());
    }
  });

  it('tam olarak bir market kapali (STORE_CLOSED senaryosu)', () => {
    expect(markets.filter((market) => !market.isOpen).map((market) => market.id)).toEqual([
      'mkt_a101-abbasaga',
    ]);
  });

  it('puan onda bir hassasiyetle 0-50; sure araligi ters degil', () => {
    for (const { rating, deliveryTime } of markets) {
      expect(rating.averageTenths).toBeGreaterThanOrEqual(0);
      expect(rating.averageTenths).toBeLessThanOrEqual(50);
      expect(deliveryTime.minMinutes).toBeLessThanOrEqual(deliveryTime.maxMinutes);
    }
  });

  it('gorseller GORELI yoldur: alan adi veriye yazilmaz', () => {
    const imageUrls = [
      ...categories.map((category) => category.imageUrl),
      ...products.map((product) => product.imageUrl),
      ...markets.map((market) => market.coverUrl),
    ];
    for (const imageUrl of imageUrls) {
      expect(imageUrl.startsWith('/')).toBe(true);
      expect(imageUrl).not.toContain('://');
    }
  });

  it('logo yok (istemci bas harf rozeti); kapak dukkan turunun gorseli (T11.11)', () => {
    for (const market of markets) {
      expect(market.logoUrl, market.id).toBe('');
      expect(market.coverUrl, market.id).toBe(`/img/market/${market.storeType.toLowerCase()}.jpg`);
    }
  });

  it('kapak dosyalari web in public klasorunde var (apps/web/README.md lisans tablosu)', () => {
    for (const coverUrl of new Set(markets.map((market) => market.coverUrl))) {
      const file = fileURLToPath(new URL(`../../../web/public${coverUrl}`, import.meta.url));

      expect(existsSync(file), coverUrl).toBe(true);
    }
  });
});
