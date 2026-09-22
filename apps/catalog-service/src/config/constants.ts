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
 * Serbest metin aramasi icin en kisa sorgu.
 * Sozlesmede yazili (catalog.proto): tek harflik sorgu reddedilir; gateway de
 * ayni esigi uygular, burasi savunma amacli ikinci kapidir.
 */
export const MIN_SEARCH_QUERY_LENGTH = 2;

/**
 * Para birimi kodu (ISO-4217).
 *
 * common.proto'daki kural: alan bos birakilirsa "TRY" varsayilir ama BOSLUK
 * DOLDURMA SORUMLULUGU SUNUCUDADIR. Bu yuzden cevaba acikca yaziyoruz;
 * istemcinin varsayim yapmasi gerekmesin.
 */
export const DEFAULT_CURRENCY = 'TRY';
