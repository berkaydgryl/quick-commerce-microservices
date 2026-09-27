/**
 * Katalog servisinin sabitleri.
 * Koda ciplak sayi/metin yazilmaz; is sabitleri burada isimlendirilir.
 */

/** Gunlukte ve acilis kaydinda gorunen kisa ad. */
export const SERVICE_NAME = 'catalog';

/** Health tablosunda ve grpcurl cagrilarinda kullanilan tam nitelikli ad. */
export const CATALOG_SERVICE_FULL_NAME = 'getir.catalog.v1.CatalogService';

/** Roadmap'teki port haritasindan: catalog 50051. */
export const DEFAULT_CATALOG_GRPC_PORT = 50_051;

/**
 * Para birimi kodu (ISO-4217).
 *
 * common.proto'daki kural: alan bos birakilirsa "TRY" varsayilir ama BOSLUK
 * DOLDURMA SORUMLULUGU SUNUCUDADIR. Bu yuzden cevaba acikca yaziyoruz;
 * istemcinin varsayim yapmasi gerekmesin.
 */
export const DEFAULT_CURRENCY = 'TRY';

/**
 * BatchGetOffers tek cagrida en fazla bu kadar urun kimligi kabul eder
 * (catalog.proto sozlesmesi). Sepet en fazla 50 kalemdir; 100 genis bir tavandir,
 * daha fazlasi VALIDATION_FAILED.
 */
export const MAX_BATCH_OFFER_IDS = 100;

/**
 * ListNearbyMarkets'te degerlendirilen en yakin market sayisi (ADR-15).
 *
 * NEDEN SINIR: her istekte tum marketleri mesafeye gore siralamak market
 * sayisiyla buyur. Teslimat yaricaplari birkac km oldugu icin bir konumu
 * kapsayan marketler en yakinlar arasindadir. Pazaryerinde ayni semtte bircok
 * market olabildigi icin sinir, tek depo modelindeki 5'ten genistir.
 * VARSAYIM: hicbir marketin yaricapi, kendisinden yakin 20 marketi atlayacak
 * kadar buyuk degildir; bozulursa sinir artirilir, sorgu degismez.
 */
export const MARKET_CANDIDATE_LIMIT = 20;

/**
 * Kategori listelerinin ust siniri (D6). Kategori taksonomisi SINIRLI bir
 * listedir: seed yazar, kullanici uretmez. Bu yuzden ListCategories ve
 * ListMarketCategories sayfalanmaz (proje-kurallari.mdc "Sinirli listeler"
 * istisnasi); onun yerine okuma bu sayida kesilir ve seed bu sayidan fazla
 * kategori yazmayi reddeder - kesme gercekte hic devreye girmez, yalnizca
 * yanlis veriye karsi tavandir. Bugun 5 kategori var; 100 vitrinin
 * gosterebileceginden cok fazladir.
 */
export const MAX_CATEGORY_COUNT = 100;
