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

  it('teklif belgesi urun kopyasi ve arama alanlarini tasir ama domain e sizdirmaz', () => {
    if (chocolate === undefined) throw new Error('demo verisi eksik');

    const document = toOfferDocument(
      { marketId: 'mkt_a101-caferaga', productId: chocolate.id, priceMinor: 3030, isActive: true },
      chocolate,
    );

    expect(document._id).toBe('ofr_a101-caferaga-cikolata-80');
    expect(document.categoryId).toBe(chocolate.categoryId);
    // Turkce kucuk harf: "Çikolata 80 g" -> "çikolata 80 g"
    expect(document.searchTerms).toEqual(['çikolata 80 g', 'sütlü çikolata']);
    expect(fromOfferDocument(document)).toEqual({
      id: 'ofr_a101-caferaga-cikolata-80',
      marketId: 'mkt_a101-caferaga',
      product: chocolate,
      priceMinor: 3030,
      isActive: true,
    });
  });
});
