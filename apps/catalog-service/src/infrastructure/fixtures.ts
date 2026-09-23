/**
 * Katalog demo verisi - PAZARYERI (ADR-15, T4.8). TEK KAYNAK.
 *
 * Iki moda birden hizmet eder:
 *   - MOCK=true : bellek okuyuculari (infrastructure/memory) bu veriyi dondurur,
 *   - seed      : `pnpm seed` ayni veriyi Mongo'ya yazar (src/seed.ts).
 * Iki ayri kopya olsaydi MOCK modu ile gercek mod zamanla farkli katalog
 * gosterirdi ve frontend "mock'ta calisiyordu" hatasiyla karsilasirdi.
 *
 * NEDEN infra/seed ALTINDA DEGIL: (1) veri bu servisin koleksiyonlarinin
 * verisidir ve ADR-05 geregi onlara yalnizca bu servis yazar; (2) .dockerignore
 * infra/'yi imaja almaz - MOCK modundaki konteyner veriyi bulamazdi.
 *
 * Icerik (docs/roadmap.md "Pazaryeri demo verisi" tablosu): 5 kategori, 15
 * ortak urun, iki semtte 6 market. Her market kendi fiyati, kurali ve
 * cesidiyle gelir: A101 daha ucuz, Carrefour daha pahali; manav yalnizca
 * meyve-sebze satar; A101 Abbasaga KAPALIDIR. Degerler market panelinin
 * girecegi degerleri temsil eder (panel kapsam disi).
 *
 * Fiyatlar KURUS cinsinden tam sayidir (3490 = 34,90 TL). Gorseller GORELI
 * yoldur; mutlak URL'yi gateway (BFF) ASSET_BASE_URL ile kurar.
 */

import type { CatalogSnapshot } from '../domain/catalog-snapshot.js';
import { CATEGORIES, PRODUCTS } from './fixtures/catalog-items.js';
import { MARKETS } from './fixtures/markets.js';
import { OFFERS } from './fixtures/offers.js';

export { CATEGORIES, MARKETS, OFFERS, PRODUCTS };

/** Katalogun tamami: MOCK modu ve seed ayni degeri kullanir. */
export const CATALOG_SNAPSHOT: CatalogSnapshot = {
  categories: CATEGORIES,
  products: PRODUCTS,
  markets: MARKETS,
  offers: OFFERS,
};
