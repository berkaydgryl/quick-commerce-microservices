/**
 * Domain <-> belge cevirisi. Mongo gerektirmez: saf fonksiyonlar.
 */

import { describe, expect, it } from 'vitest';

import { CATALOG_SNAPSHOT } from '../../src/infrastructure/fixtures.js';
import {
  fromCategoryDocument,
  fromDarkStoreDocument,
  fromProductDocument,
  toCategoryDocument,
  toDarkStoreDocument,
  toProductDocument,
} from '../../src/infrastructure/mongo/mappers.js';

const [category] = CATALOG_SNAPSHOT.categories;
const chocolate = CATALOG_SNAPSHOT.products.find((product) => product.sku === 'CIKOLATA-80');
const [kadikoy] = CATALOG_SNAPSHOT.darkStores;

describe('mongo mappers', () => {
  it('kategori gidis-donus ayni kalir', () => {
    expect(category).toBeDefined();
    if (category === undefined) return;

    expect(fromCategoryDocument(toCategoryDocument(category))).toEqual(category);
  });

  it('urun belgesi sorgu alanlarini tasir ama domain e sizdirmaz', () => {
    expect(chocolate).toBeDefined();
    if (chocolate === undefined) return;

    const document = toProductDocument(chocolate, ['ds_besiktas', 'ds_kadikoy']);

    expect(document._id).toBe(chocolate.id);
    expect(document.darkStoreIds).toEqual(['ds_besiktas', 'ds_kadikoy']);
    // Turkce kucuk harf: "Çikolata 80 g" -> "çikolata 80 g"
    expect(document.searchTerms).toEqual(['çikolata 80 g', 'sütlü çikolata']);
    expect(fromProductDocument(document)).toEqual(chocolate);
  });

  it('konum GeoJSON sirasiyla yazilir: [boylam, enlem]', () => {
    expect(kadikoy).toBeDefined();
    if (kadikoy === undefined) return;

    const document = toDarkStoreDocument(kadikoy);

    // Ters yazilirsa 2dsphere indeksi hata vermez ama depo Iran'a tasinir.
    expect(document.location).toEqual({ type: 'Point', coordinates: [kadikoy.lng, kadikoy.lat] });
    expect(fromDarkStoreDocument(document)).toEqual(kadikoy);
  });
});
