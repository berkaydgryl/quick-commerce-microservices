/** Risk servisinin is sabitleri (ADR-11). */

export const SERVICE_NAME = 'risk';

/** Proto'daki tam servis adi; saglik kaydi ve gunluk bunu kullanir. */
export const RISK_SERVICE_FULL_NAME = 'getir.risk.v1.RiskService';

/** Roadmap'teki port haritasindan: risk 50055. */
export const DEFAULT_RISK_GRPC_PORT = 50_055;

/**
 * Servisin kendi veritabani (D14, ADR-05): RISK_MONGO_DB verilmezse.
 * Kullanicisi (RISK_MONGO_URI) yalnizca burada yetkilidir.
 */
export const DEFAULT_MONGO_DB = 'getir_risk';

/**
 * Tek bir kuralin en fazla bekleyebilecegi sure. Evaluate checkout'un kritik
 * yolundadir; takilan bir kural siparisi bekletmemeli. Suresi dolan kural
 * hata gibi islenir: 0 puan + uyari, degerlendirme devam eder.
 */
export const RULE_TIMEOUT_MS = 200;

/**
 * risk_events kaydinin en fazla beklenecegi sure (#167). Kurallar paralel
 * kosar (en fazla RULE_TIMEOUT_MS), ardindan kayit: karar en kotu ~400 ms'de
 * doner, order'in risk butcesinin (RISK_CALL_TIMEOUT_MS, 1 sn) altinda. Sinir
 * asilinca kayit beklenmez (WARN + metrik), karar yine doner.
 */
export const RISK_EVENT_RECORD_TIMEOUT_MS = 200;

/**
 * Kapanista arka planda suren kayitlarin en fazla beklenecegi sure (#167):
 * gRPC durduktan sonra, Mongo kapanmadan once. Mongo'nun islem siniri
 * (MONGO_OPERATION_TIMEOUT_MS) kadar: o surede kayit ya biter ya surucu keser.
 * Ust sinir: kapanis kancasinin 10 sn butcesinde Mongo kapanisina pay kalsin.
 * Mongo yoksa (MOCK) varsayilan. Bitmeyen kayit `failed` sayilir.
 */
export const RISK_EVENT_DRAIN_DEFAULT_MS = 2_000;
export const RISK_EVENT_DRAIN_MAX_MS = 8_000;

// ---------------------------------------------------------------------------
// Cekirdek kural esikleri (T6.2). Agirliklar config/risk.rules.json'da;
// burada yalnizca "ne zaman tetiklenir" sinirlari durur.
// ---------------------------------------------------------------------------

/** account-age: bundan GENC hesap tetikler (tam 24 saat tetiklemez). */
export const NEW_ACCOUNT_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/** order-history: iptal orani bunun USTUNDEYSE tetikler (tam %50 tetiklemez). */
export const MAX_CANCEL_RATIO = 0.5;

/** basket-anomaly: sepet, ortalamanin bu katinin USTUNDEYSE tetikler. */
export const BASKET_ANOMALY_MULTIPLIER = 3;

/** checkout-dwell: rezervasyondan siparise bundan KISA sure tetikler (bot hizi). */
export const MIN_CHECKOUT_DWELL_MS = 3000;

/**
 * geofence: teslimat konumu ile oturum konumu arasi bundan FAZLAYSA tetikler.
 * 50 km: Istanbul icinde ilceler arasini "ayni sehir" sayar, baska bir sehri
 * yakalar (T6.2 karari; baglamda sehir adi yok, yalnizca koordinat var).
 */
export const GEOFENCE_MAX_DISTANCE_KM = 50;

/** ip-device: ayni cihazda bu kadar ve USTU hesap KESIN KURALDIR (veto). */
export const MAX_ACCOUNTS_PER_DEVICE = 3;
