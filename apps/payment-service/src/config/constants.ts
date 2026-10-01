/** Odeme servisinin is sabitleri (ADR-11). Ortamdan gelenler env.ts'tedir. */

export const SERVICE_NAME = 'payment';

/** Proto'daki tam servis adi; saglik kaydi ve gunluk bunu kullanir. */
export const PAYMENT_SERVICE_FULL_NAME = 'getir.payment.v1.PaymentService';

/** Roadmap'teki port haritasindan: payment 50054. */
export const DEFAULT_PAYMENT_GRPC_PORT = 50_054;

/**
 * Servisin kendi veritabani (D14, ADR-05): PAYMENT_MONGO_DB verilmezse.
 * Kullanicisi (PAYMENT_MONGO_URI) yalnizca burada yetkilidir.
 */
export const DEFAULT_MONGO_DB = 'getir_payment';

/**
 * 3DS dogrulama jetonunun omru. Suresi dolan jetonla Confirm3Ds kabul
 * edilmez (T5.2); rezervasyon uzatmasi da bu sureye gore hesaplanmistir (B21).
 */
export const THREEDS_CHALLENGE_TTL_MS = 60_000;

/** 3DS yanlis kod hakki: bu sayiya ulasinca dogrulama kilitlenir, odeme FAILED (B5). */
export const THREEDS_MAX_ATTEMPTS = 3;

/**
 * Confirm3Ds surum cakismasinda en fazla kac kez yeniden okunup yazilir.
 * Cakisma ancak ayni dogrulamaya es zamanli deneme gelince olur; her turda bir
 * deneme kesinlesir, hak sayisi kadar tur yeter.
 */
export const CONFIRM_3DS_MAX_WRITE_RETRIES = THREEDS_MAX_ATTEMPTS;

/**
 * Olay dinleme (T7.4): tuketici grubu servis adidir. Payment'in her kopyasi
 * ayni gruptadir; bir iade komutunu yalnizca biri isler.
 */
export const EVENT_CONSUMER_GROUP = SERVICE_NAME;
