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
 * Servisin kendi veritabani (D14, ADR-05): INVENTORY_MONGO_DB verilmezse.
 * Kullanicisi (INVENTORY_MONGO_URI) yalnizca burada yetkilidir.
 */
export const DEFAULT_MONGO_DB = 'getir_inventory';

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
 * Uzatma (T11.3, roadmap B21): rezervasyon basina en cok kac kez
 * (RESERVATION_MAX_EXTENSIONS; .env.example ile ayni varsayilan). 3 x 60 sn,
 * ucuncu 3DS denemesini de kapsar. Ust sinir korumadir: sinirsiz uzatma stogu
 * sinirsiz kilitlerdi.
 */
export const DEFAULT_RESERVATION_MAX_EXTENSIONS = 3;
export const RESERVATION_MAX_EXTENSIONS_LIMIT = 10;

/**
 * Tek uzatmanin en uzun hali (sn, ExtendReservationRequest.additional_seconds).
 * Sureyi order verir (RESERVATION_EXTEND_SECONDS, 60); bu sinir KORUMADIR.
 */
export const RESERVATION_EXTEND_MAX_SECONDS = 300;

/**
 * Rezervasyon hash'inin sure dolduktan SONRA Redis'te kalma payi (inventory.proto
 * Reservation.expires_at: "Redis hash'i bundan 60 saniye SONRA silinir"):
 * supurucu gecikmeli tick'inde kaydi (adetleri) hala okuyabilsin (T10.3).
 */
export const RESERVATION_HOLD_AFTER_EXPIRY_MS = 60_000;

/**
 * Sonuclanan (birakilan ya da onaylanan) rezervasyonun Redis'teki izinin en uzun omru (T10.2,
 * ADR-18). Iz, defter kaydi yazilinca hemen silinir; bu sure yalnizca Mongo
 * erisilemezken yarida kalan kaydin tekrar gelen istekle tamamlanabilecegi
 * pencereyi sinirlar (idempotency kaydinin 24 saati ile ayni olcek).
 */
export const SETTLED_RESERVATION_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Defter denetiminde (reseed, B24) gunluge yazilan tutmayan kayit sayisi ust
 * siniri; toplam sayi ayrica yazilir. Gunluk satiri sinirsiz buyumesin.
 */
export const LEDGER_MISMATCH_REPORT_LIMIT = 10;

/** Lua script'lerinin adlari: lua/ klasorundeki dosya adi (uzantisiz). */
export const LUA_SCRIPTS = {
  RESERVE: 'reserve',
  RELEASE: 'release',
  COMMIT: 'commit',
  EXTEND: 'extend',
  SHORTEN: 'shorten',
  LEADER: 'leader',
} as const;

/**
 * Supurucu (T10.3; ADR-02, roadmap B25). Varsayilanlar .env.example ile ayni:
 * tur 1 sn, liderlik kilidinin omru 3 sn (her turda yenilenir; lider duserse
 * en gec 3 sn'de baska ornek devralir). Kilit omru turdan belirgin buyuk
 * olmali: en az iki tur (env dogrular).
 */
export const DEFAULT_SWEEPER_INTERVAL_MS = 1_000;
export const SWEEPER_INTERVAL_MIN_MS = 100;
export const SWEEPER_INTERVAL_MAX_MS = 60_000;
export const DEFAULT_SWEEPER_LOCK_TTL_SECONDS = 3;
export const SWEEPER_LOCK_TTL_MAX_SECONDS = 60;
/** Kilit omru en az bu kadar tur surmeli (yenileme kacarsa kilit hemen dusmesin). */
export const SWEEPER_LOCK_MIN_TURNS = 2;

/** Market basina tur basina en cok kac suresi dolmus siparis (kalani sonraki tura). */
export const SWEEP_BATCH_SIZE = 100;

/** Supurucunun market listesini (Mongo stock) tazeleme araligi. */
export const SWEEPER_MARKET_REFRESH_MS = 60_000;

export const MS_PER_SECOND = 1_000;

/**
 * Redis bosalinca bir istegin sayaclarin yeniden kurulmasini en fazla bekledigi
 * sure (T10.1 PR 2). Demo verisi milisaniyeler surer; asilirsa istek
 * SERVICE_UNAVAILABLE alir (tekrar denenebilir), kurulum arka planda surer.
 */
export const COUNTER_RECOVERY_TIMEOUT_MS = 5_000;
