/**
 * Pazaryeri demo verisinin butunlugu (ADR-15). Seed ve MOCK modu bu veriyi
 * kullanir; burada bir hata ya seed'i (benzersiz indeks ihlali) ya da istemciyi
 * (bos market sayfasi, yanlis fiyat) bozar.
 */

import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import type { StoreType } from '../../src/domain/catalog.js';
import { offerIdFor, STORE_TYPE } from '../../src/domain/catalog.js';
import { ASSORTMENT_GROUPS } from '../../src/infrastructure/fixtures/assortment-groups.js';
import { ASSORTMENTS } from '../../src/infrastructure/fixtures/assortments.js';
import {
  BASE_PRICES,
  BRAND_PRICE_INDEX,
} from '../../src/infrastructure/fixtures/offers/base-prices.js';
import { MARKET_CANDIDATE_LIMIT } from '../../src/config/constants.js';
import { distanceMeters } from '../../src/domain/geo.js';
import { coveringMarkets } from '../../src/domain/market-coverage.js';
import { CATALOG_SNAPSHOT } from '../../src/infrastructure/fixtures.js';
import { CLASSIC_SNAPSHOT } from '../support/classic-catalog.js';
import { DEMO_ADDRESSES, EXPECTED_NEARBY } from '../support/demo-addresses.js';

const { categories, products, markets, offers } = CATALOG_SNAPSHOT;

/** Logo dosyasinin adi: marka, Turkce harfler ASCII'ye, bosluk tireye ("Kardeşler Manavı" -> kardesler-manavi). */
const TURKISH_ASCII: Readonly<Record<string, string>> = {
  ç: 'c',
  ğ: 'g',
  ı: 'i',
  i̇: 'i',
  ö: 'o',
  ş: 's',
  ü: 'u',
};

function brandSlug(brand: string): string {
  return brand
    .toLocaleLowerCase('tr')
    .replace(/i̇|[çğıöşü]/g, (letter) => TURKISH_ASCII[letter] ?? letter)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function duplicates(values: readonly string[]): string[] {
  const seen = new Set<string>();
  return values.filter((value) => seen.has(value) || !seen.add(value));
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
  it('13 kategori, 122 ortak urun, 33 market, 1505 teklif (roadmap paragrafi)', () => {
    expect(categories).toHaveLength(13);
    expect(products).toHaveLength(122);
    expect(markets).toHaveLength(33);
    expect(offers).toHaveLength(1505);
  });

  it('eski veri DEGISMEDI: guncel veri KLASIK kumeyle baslar, kume 07.10 oncesiyle bayt bayt ayni', () => {
    expect(products.slice(0, CLASSIC_SNAPSHOT.products.length)).toEqual(CLASSIC_SNAPSHOT.products);
    expect(markets.slice(0, CLASSIC_SNAPSHOT.markets.length)).toEqual(CLASSIC_SNAPSHOT.markets);
    expect(offers.slice(0, CLASSIC_SNAPSHOT.offers.length)).toEqual(CLASSIC_SNAPSHOT.offers);
    // 07.10 oncesi CATALOG_SNAPSHOT'in (main 29c62cd) JSON ozeti: kimlik, fiyat
    // ve stok senaryolari (sepetler, favoriler, QA betikleri) bu veriye dayanir.
    expect(createHash('sha256').update(JSON.stringify(CLASSIC_SNAPSHOT)).digest('hex')).toBe(
      '5ff7e3a3413b14c35d1b8dceb04bbd6534fa79e37818dd3c82350840b0805ffb',
    );
  });

  it('cesitlilik (07.10): her kategoride en az 8 urun; zincir 60-100, dukkan en az 6 urun', () => {
    for (const category of categories) {
      const count = products.filter((product) => product.categoryId === category.id).length;
      expect(count, category.id).toBeGreaterThanOrEqual(8);
    }
    for (const market of markets) {
      const count = offers.filter((offer) => offer.marketId === market.id).length;
      if (market.storeType === STORE_TYPE.MARKET) {
        expect(count, market.id).toBeGreaterThanOrEqual(60);
        expect(count, market.id).toBeLessThanOrEqual(100);
      } else {
        expect(count, market.id).toBeGreaterThanOrEqual(6);
      }
    }
  });

  it('uretilen teklif: taban fiyat x marka endeksi, ,90 ile biter; her SKU nin tabani ve urunu var', () => {
    const generated = offers.slice(CLASSIC_SNAPSHOT.offers.length);
    expect(generated.every((offer) => offer.priceMinor % 100 === 90 && offer.isActive)).toBe(true);

    const skus = new Set(products.map((product) => product.sku));
    expect(Object.keys(BASE_PRICES).sort()).toEqual([...skus].sort());
    const grouped = Object.values(ASSORTMENT_GROUPS).flat();
    expect(grouped.filter((sku) => !skus.has(sku))).toEqual([]);
    expect(Object.keys(ASSORTMENTS).sort()).toEqual(markets.map((market) => market.id).sort());
  });

  it('her markanin fiyat endeksi ACIKCA var (sessiz 100 yok); fazlasi da yok', () => {
    const brands = [...new Set(markets.map((market) => market.brand))].sort();

    expect(Object.keys(BRAND_PRICE_INDEX).sort()).toEqual(brands);
  });

  it('her demo adresinde kapsayan market sayisi aday sinirinin (MARKET_CANDIDATE_LIMIT) en az 3 altinda', () => {
    for (const address of DEMO_ADDRESSES) {
      const covering = coveringMarkets(
        markets.map((market) => ({
          market,
          distanceMeters: distanceMeters(address.location, market),
        })),
      );
      expect(covering.length, address.title).toBeLessThanOrEqual(MARKET_CANDIDATE_LIMIT - 3);
    }
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

  it('her semtte TAM BIR market kapali (STORE_CLOSED senaryosu; Kadikoy 41. enlemin guneyi)', () => {
    const closed = markets.filter((market) => !market.isOpen);

    expect(closed.map((market) => market.id)).toEqual([
      'mkt_a101-abbasaga',
      'mkt_carrefour-express-kadikoy',
    ]);
    expect(closed.filter((market) => market.lat < 41)).toHaveLength(1);
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
      ...markets.map((market) => market.logoUrl),
    ];
    for (const imageUrl of imageUrls) {
      expect(imageUrl.startsWith('/')).toBe(true);
      expect(imageUrl).not.toContain('://');
    }
  });

  it('kapak dukkan turunun gorseli; logo markanin gecici yazi logosu (T11.11, 07.10)', () => {
    for (const market of markets) {
      expect(market.coverUrl, market.id).toBe(`/img/market/${market.storeType.toLowerCase()}.jpg`);
      expect(market.logoUrl, market.id).toBe(`/img/market-logo/${brandSlug(market.brand)}.svg`);
    }
  });

  it('ayni markanin subeleri ayni logoyu kullanir; her markanin bir logosu var', () => {
    const logos = new Map<string, string>();
    for (const market of markets) {
      expect(logos.get(market.brand) ?? market.logoUrl, market.id).toBe(market.logoUrl);
      logos.set(market.brand, market.logoUrl);
    }
    expect(new Set(logos.values()).size).toBe(logos.size);
  });

  it('kapak ve logo dosyalari web in public klasorunde var (apps/web/README.md)', () => {
    const urls = new Set(markets.flatMap((market) => [market.coverUrl, market.logoUrl]));
    for (const url of urls) {
      const file = fileURLToPath(new URL(`../../../web/public${url}`, import.meta.url));

      expect(existsSync(file), url).toBe(true);
    }
  });
});
