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

/**
 * Rezervasyon suresi siniri (saniye, T10.1). Sureyi order verir (risk bandindan
 * turer: dusuk 600, orta 120; inventory.proto ReserveRequest.ttl_seconds); bu
 * sinir karar degil KORUMADIR: 0, negatif ya da gunlerce suren bir sure stogu
 * aninda birakir ya da kilitler. Disi VALIDATION_FAILED.
 */
export const RESERVATION_TTL_MIN_SECONDS = 30;
export const RESERVATION_TTL_MAX_SECONDS = 900;

/**
 * Rezervasyon hash'inin sure dolduktan SONRA Redis'te kalma payi (inventory.proto
 * Reservation.expires_at: "Redis hash'i bundan 60 saniye SONRA silinir"):
 * supurucu gecikmeli tick'inde kaydi (adetleri) hala okuyabilsin (T10.3).
 */
export const RESERVATION_HOLD_AFTER_EXPIRY_MS = 60_000;

/**
 * Sonuclanan (birakilan) rezervasyonun Redis'teki izinin en uzun omru (T10.2,
 * ADR-18). Iz, defter kaydi yazilinca hemen silinir; bu sure yalnizca Mongo
 * erisilemezken yarida kalan kaydin tekrar gelen istekle tamamlanabilecegi
 * pencereyi sinirlar (idempotency kaydinin 24 saati ile ayni olcek).
 */
export const SETTLED_RESERVATION_TTL_MS = 24 * 60 * 60 * 1000;

/** Lua script'lerinin adlari: lua/ klasorundeki dosya adi (uzantisiz). */
export const LUA_SCRIPTS = {
  RESERVE: 'reserve',
  RELEASE: 'release',
} as const;

/**
 * Redis bosalinca bir istegin sayaclarin yeniden kurulmasini en fazla bekledigi
 * sure (T10.1 PR 2). Demo verisi milisaniyeler surer; asilirsa istek
 * SERVICE_UNAVAILABLE alir (tekrar denenebilir), kurulum arka planda surer.
 */
export const COUNTER_RECOVERY_TIMEOUT_MS = 5_000;
