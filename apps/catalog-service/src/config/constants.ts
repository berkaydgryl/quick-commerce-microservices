/**
 * Katalog servisinin sabitleri.
 * Koda ciplak sayi/metin yazilmaz; is sabitleri burada isimlendirilir.
 */

import { FAVORITE_MARKETS_MAX, SEARCH_RESULT_PRODUCTS_MAX } from '@getir/contracts';

/** Gunlukte ve acilis kaydinda gorunen kisa ad. */
export const SERVICE_NAME = 'catalog';

/** Health tablosunda ve grpcurl cagrilarinda kullanilan tam nitelikli ad. */
export const CATALOG_SERVICE_FULL_NAME = 'getir.catalog.v1.CatalogService';

/** Roadmap'teki port haritasindan: catalog 50051. */
export const DEFAULT_CATALOG_GRPC_PORT = 50_051;

/**
 * Servisin kendi veritabani (D14, ADR-05): CATALOG_MONGO_DB verilmezse.
 * Kullanicisi (CATALOG_MONGO_URI) yalnizca burada yetkilidir.
 */
export const DEFAULT_MONGO_DB = 'getir_catalog';

/**
 * BatchGetOffers tek cagrida en fazla bu kadar urun kimligi kabul eder
 * (catalog.proto sozlesmesi). Sepet en fazla 50 kalemdir; 100 genis bir tavandir,
 * daha fazlasi VALIDATION_FAILED.
 */
export const MAX_BATCH_OFFER_IDS = 100;

/**
 * BatchGetMarkets tek cagrida en fazla bu kadar market kimligi kabul eder
 * (T11.13). Favori isletmeler sayfasinin kaynagidir: kullanici en fazla
 * FAVORITE_MARKETS_MAX market saklar; deger sozlesmeden gelir.
 */
export const MAX_BATCH_MARKET_IDS = FAVORITE_MARKETS_MAX;

/**
 * ListNearbyMarkets ve genel aramada gosterilen en fazla KAPSAYAN market (ADR-15).
 *
 * Sinir kapsamadan SONRA uygulanir (#175): sorgu konumu teslim yaricapi icinde
 * kalan marketleri yakindan uzaga verir ve ilk 20'sini alir. Yakin ama kapsamayan
 * marketler, arkalarindaki genis yaricapli kapsayan marketi gizlemez (eskiden
 * en yakin 20 market alinip SONRA suzuluyordu). 20'den fazla market kapsarsa en
 * uzaklari gosterilmez; pazaryerinde ayni semtte bircok market olabildigi icin
 * sinir tek depo modelindeki 5'ten genistir. Demo verisinde (07.10) Ev'i 16, Is'i
 * 17 market kapsar; en az 3'luk payi catalog-fixtures.spec denetler.
 */
export const MARKET_CANDIDATE_LIMIT = 20;

/**
 * Genel aramada (T9.6) market basina gosterilen en fazla teklif. Fazlasi
 * sayilir (toplam eslesme); istemci "+N urun daha" ile market sayfasina,
 * ayni aramayla gecer (30 Eylul karari). Deger REST sozlesmesindedir: istemci
 * de ayni siniri gorur (searchResultSchema.products).
 */
export const MAX_SEARCH_OFFERS_PER_MARKET = SEARCH_RESULT_PRODUCTS_MAX;

/**
 * Kategori listelerinin ust siniri (D6). Kategori taksonomisi SINIRLI bir
 * listedir: seed yazar, kullanici uretmez. Bu yuzden ListCategories ve
 * ListMarketCategories sayfalanmaz (proje-kurallari.mdc "Sinirli listeler"
 * istisnasi); onun yerine okuma bu sayida kesilir ve seed bu sayidan fazla
 * kategori yazmayi reddeder - kesme gercekte hic devreye girmez, yalnizca
 * yanlis veriye karsi tavandir. Bugun 13 kategori var (T11.6); 100 vitrinin
 * gosterebileceginden cok fazladir.
 */
export const MAX_CATEGORY_COUNT = 100;
