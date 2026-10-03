/**
 * Domain <-> belge cevirisi. Mongo gerektirmez: saf fonksiyonlar.
 */

import { describe, expect, it } from 'vitest';

import { CATALOG_SNAPSHOT } from '../../src/infrastructure/fixtures.js';
import {
  fromCategoryDocument,
  fromMarketDocument,
  fromOfferDocument,
  fromProductDocument,
  toCategoryDocument,
  toMarketDocument,
  toOfferDocument,
  toProductDocument,
} from '../../src/infrastructure/mongo/mappers.js';

const [category] = CATALOG_SNAPSHOT.categories;
const [market] = CATALOG_SNAPSHOT.markets;
const chocolate = CATALOG_SNAPSHOT.products.find((product) => product.sku === 'CIKOLATA-80');

describe('mongo mappers', () => {
  it('kategori ve urun gidis-donus ayni kalir', () => {
    if (category === undefined || chocolate === undefined) throw new Error('demo verisi eksik');

    expect(fromCategoryDocument(toCategoryDocument(category))).toEqual(category);
    expect(fromProductDocument(toProductDocument(chocolate))).toEqual(chocolate);
  });

  it('market konumu GeoJSON sirasiyla yazilir: [boylam, enlem]; kurallar korunur', () => {
    if (market === undefined) throw new Error('demo verisi eksik');

    const document = toMarketDocument(market);

    // Ters yazilirsa 2dsphere indeksi hata vermez ama market baska kitaya tasinir.
    expect(document.location).toEqual({ type: 'Point', coordinates: [market.lng, market.lat] });
    expect(fromMarketDocument(document)).toEqual(market);
  });

  it('T11.11 oncesi belge (tur ve kapak yok): genel market, kapaksiz', () => {
    if (market === undefined) throw new Error('demo verisi eksik');
    const { storeType: _type, coverUrl: _cover, ...legacy } = toMarketDocument(market);

    expect(fromMarketDocument(legacy)).toEqual({ ...market, storeType: 'MARKET', coverUrl: '' });
  });

  it('teklif belgesi urun kopyasi ve arama alanlarini tasir ama domain e sizdirmaz', () => {
    if (chocolate === undefined) throw new Error('demo verisi eksik');

    const offer = {
      id: 'ofr_a101-caferaga-cikolata-80',
      marketId: 'mkt_a101-caferaga',
      product: chocolate,
      priceMinor: 3030,
      isActive: true,
    };

    const document = toOfferDocument(offer);

    expect(document._id).toBe('ofr_a101-caferaga-cikolata-80');
    expect(document.categoryId).toBe(chocolate.categoryId);
    // Turkce kucuk harf ve katlama (T9.4): "Çikolata 80 g" -> "cikolata 80 g"
    expect(document.searchTerms).toEqual(['cikolata 80 g', 'sutlu cikolata']);
    expect(document.productId).toBe(chocolate.id);
    expect(fromOfferDocument(document)).toEqual(offer);
  });
});
