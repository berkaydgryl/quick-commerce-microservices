/**
 * Siparis servisinin sabitleri.
 */

/** Gunlukte ve acilis kaydinda gorunen kisa ad. */
export const SERVICE_NAME = 'order';

/** Health tablosunda ve grpcurl cagrilarinda kullanilan tam nitelikli ad. */
export const ORDER_SERVICE_FULL_NAME = 'getir.order.v1.OrderService';

/** Roadmap'teki port haritasindan: order 50053. */
export const DEFAULT_ORDER_GRPC_PORT = 50_053;

/**
 * Servisin kendi veritabani (D14, ADR-05): ORDER_MONGO_DB verilmezse.
 * Kullanicisi (ORDER_MONGO_URI) yalnizca burada yetkilidir.
 */
export const DEFAULT_MONGO_DB = 'getir_order';

// Idempotency anahtari ve sepet sinirlari burada TEKRAR YAZILMAZ: REST sozlesmesiyle
// ayni kaynaktan (@getir/contracts) gelir; iki kapida iki farkli sinir olmasin.

/** Catalog'un varsayilan adresi (roadmap port haritasi: catalog 50051). */
export const DEFAULT_CATALOG_GRPC_ADDR = 'localhost:50051';

/**
 * order -> catalog cagrisinin sure siniri (ms). Taslak acma kullanicinin
 * bekledigi yoldadir: catalog takilirsa SERVICE_UNAVAILABLE ile hizli donmek,
 * gateway'in kendi 5 sn'lik sinirina (GATEWAY_REQUEST_TIMEOUT_MS) takilmaktan iyidir.
 */
export const CATALOG_CALL_TIMEOUT_MS = 2_000;

/** Risk ve odeme servislerinin varsayilan adresleri (roadmap port haritasi). */
export const DEFAULT_RISK_GRPC_ADDR = 'localhost:50055';
export const DEFAULT_PAYMENT_GRPC_ADDR = 'localhost:50054';

/**
 * Saga cagrilarinin sure sinirlari (ms), T7.1. CreateOrder'da ikisi arka arkaya
 * calisir ve toplami gateway'in 5 sn'lik sinirinin ALTINDA kalmali
 * (GATEWAY_REQUEST_TIMEOUT_MS): once order kendi hatasini (SERVICE_UNAVAILABLE)
 * dondurmeli. Risk kurallari kendi zaman asimlariyla sinirlidir, 1 sn yeter;
 * odeme bankaya gittigi icin daha uzun.
 */
export const RISK_CALL_TIMEOUT_MS = 1_000;
export const PAYMENT_CALL_TIMEOUT_MS = 3_000;

/** Stok servisinin varsayilan adresi (roadmap port haritasi: inventory 50052). */
export const DEFAULT_INVENTORY_GRPC_ADDR = 'localhost:50052';

/**
 * order -> inventory cagrisinin sure siniri (ms), T11.2. Reserve/Commit/Release
 * tek Lua script'i (milisaniyeler); 1 sn risk cagrisiyla ayni. CreateOrder'in
 * basarili yolunda risk + odeme + kesinlestirme ardisik calisir ve sinirlarin
 * toplami (1 + 3 + 1 sn) gateway'in 5 sn'sine ESITTIR: uc cagri da sinirina yakin
 * surerse gateway once keser. Zarar yok: siparis AWAITING_PAYMENT kalir, ayni
 * istegin tekrari cekimin ilk sonucunu alir (idempotent) ve kesinlestirmeyi yeniden
 * dener; para iki kez cekilmez, stok iki kez dusmez.
 */
export const INVENTORY_CALL_TIMEOUT_MS = 1_000;

/**
 * Stok kilidinin omru (sn), RESERVATION_TTL_SECONDS. Sinirlar inventory'nin
 * kabul ettigiyle ayni (30-900); banda gore kisaltma (orta risk 120 sn) T11.3.
 */
export const DEFAULT_RESERVATION_TTL_SECONDS = 600;
export const MIN_RESERVATION_TTL_SECONDS = 30;
export const MAX_RESERVATION_TTL_SECONDS = 900;

/**
 * Gateway'in doldurdugu risk sinyali metinlerinin (IP, sehir, cihaz kimligi)
 * en uzun hali (T7.5). Deger yorumlanmaz, risk-svc'ye tasinir; sinir yalnizca
 * sinirsiz metnin kapidan gecmemesi icindir (IPv6 45 karakterdir).
 * Kupon kodu siniri REST ile ortak oldugu icin contracts'tadir (COUPON_CODE_MAX_LENGTH).
 */
export const MAX_SIGNAL_TEXT_LENGTH = 128;

/** Iptal gerekcesi anahtarinin en uzun hali (ornek: "CHANGED_MIND"). */
export const MAX_CANCEL_REASON_LENGTH = 64;

/**
 * Outbox yayincisi (T7.3, roadmap "Outbox akisi"): 500 ms'de bir tur, turda en
 * fazla 100 olay. Tam dolu parti cikarsa beklemeden devam edilir; aralik
 * yalnizca kuyruk bosken beklenir (yayin gecikmesinin ust siniri ~500 ms).
 */
export const OUTBOX_POLL_INTERVAL_MS = 500;
export const OUTBOX_BATCH_SIZE = 100;
