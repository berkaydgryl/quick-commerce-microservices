/**
 * KLASIK katalog: 07.10 cesitliliginden onceki demo verisi (13 kategori, 49
 * urun, 21 market, 166 teklif), oldugu gibi. Guncel demo verisinin BASIDIR
 * (catalog-fixtures.spec bunu ve degismedigini denetler).
 *
 * Davranis testleri (arama, listeleme, sayfalama, gRPC) bu sabit kumeyle
 * kosar: senaryolari ("Ev 'su' aramasinda 4 teklif") demo verisi buyudukce
 * degismesin. Demo verisinin butunlugu catalog-fixtures.spec'te, guncel
 * haliyle denetlenir.
 */

import type { CatalogSnapshot } from '../../src/domain/catalog-snapshot.js';
import { CATEGORIES } from '../../src/infrastructure/fixtures/categories.js';
import { BESIKTAS_MARKETS } from '../../src/infrastructure/fixtures/markets/besiktas.js';
import { KADIKOY_MARKETS } from '../../src/infrastructure/fixtures/markets/kadikoy.js';
import { PILOT_MARKETS } from '../../src/infrastructure/fixtures/markets/pilot.js';
import { EXPLICIT_OFFERS } from '../../src/infrastructure/fixtures/offers.js';
import { INITIAL_PRODUCTS } from '../../src/infrastructure/fixtures/products/initial.js';

export const CLASSIC_SNAPSHOT: CatalogSnapshot = {
  categories: CATEGORIES,
  products: INITIAL_PRODUCTS,
  markets: [...PILOT_MARKETS, ...KADIKOY_MARKETS, ...BESIKTAS_MARKETS],
  offers: EXPLICIT_OFFERS,
};
