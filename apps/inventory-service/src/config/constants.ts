/**
 * Stok servisinin sabitleri.
 * Koda ciplak sayi/metin yazilmaz; is sabitleri burada isimlendirilir.
 */

/** Gunlukte ve acilis kaydinda gorunen kisa ad. */
export const SERVICE_NAME = 'inventory';

/** Health tablosunda ve grpcurl cagrilarinda kullanilan tam nitelikli ad. */
export const INVENTORY_SERVICE_FULL_NAME = 'getir.inventory.v1.InventoryService';

/** Roadmap'teki port haritasindan: inventory 50052. */
export const DEFAULT_INVENTORY_GRPC_PORT = 50_052;

/**
 * CheckAvailability tek cagrida en fazla bu kadar SKU kabul eder
 * (inventory.proto sozlesmesi). Sepet en fazla 50 kalem, urun listesi sayfasi
 * en fazla 50 teklif; fazlasi VALIDATION_FAILED.
 */
export const MAX_AVAILABILITY_SKUS = 100;

/**
 * Redis'in bellek dolunca uygulayacagi politika: stok sayaci icin TEK kabul
 * edilen deger (roadmap P1). Tahliye (allkeys-lru, volatile-lru...) bellek
 * dolunca sayaci ya da rezervasyon indeksini silebilir: bu onbellek kacirmasi
 * degil, fazla satistir. noeviction'da Redis yeni yazimi OOM ile reddeder,
 * mevcut anahtari silmez.
 */
export const REQUIRED_EVICTION_POLICY = 'noeviction';

/**
 * Mongo'daki stok kayitlarinin Redis'e kacar kacar yazilacagi (acilis seed'i
 * ve reseed). Tek boru hattinda (pipeline) gider; butun koleksiyon bellege
 * alinmaz.
 */
export const COUNTER_SEED_BATCH_SIZE = 500;
