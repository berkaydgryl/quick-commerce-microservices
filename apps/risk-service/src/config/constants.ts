/** Risk servisinin is sabitleri (ADR-11). */

export const SERVICE_NAME = 'risk';

/** Proto'daki tam servis adi; saglik kaydi ve gunluk bunu kullanir. */
export const RISK_SERVICE_FULL_NAME = 'getir.risk.v1.RiskService';

/** Roadmap'teki port haritasindan: risk 50055. */
export const DEFAULT_RISK_GRPC_PORT = 50_055;

/**
 * Tek bir kuralin en fazla bekleyebilecegi sure. Evaluate checkout'un kritik
 * yolundadir; takilan bir kural siparisi bekletmemeli. Suresi dolan kural
 * hata gibi islenir: 0 puan + uyari, degerlendirme devam eder.
 */
export const RULE_TIMEOUT_MS = 200;

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
