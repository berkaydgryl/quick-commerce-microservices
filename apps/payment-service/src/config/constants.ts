/** Odeme servisinin is sabitleri (ADR-11). Ortamdan gelenler env.ts'tedir. */

export const SERVICE_NAME = 'payment';

/** Proto'daki tam servis adi; saglik kaydi ve gunluk bunu kullanir. */
export const PAYMENT_SERVICE_FULL_NAME = 'getir.payment.v1.PaymentService';

/** Roadmap'teki port haritasindan: payment 50054. */
export const DEFAULT_PAYMENT_GRPC_PORT = 50_054;

/**
 * 3DS dogrulama jetonunun omru. Suresi dolan jetonla Confirm3Ds kabul
 * edilmez (T5.2); rezervasyon uzatmasi da bu sureye gore hesaplanmistir (B21).
 */
export const THREEDS_CHALLENGE_TTL_MS = 60_000;

/** Tek desteklenen para birimi. Proto'da bos para birimi TRY demektir. */
export const SUPPORTED_CURRENCY = 'TRY';
