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
 * Idempotency anahtarinin en kisa uzunlugu (ADR-08).
 * Istemci UUID gonderir; cok kisa bir anahtar cakisma riskini artirir.
 */
export const MIN_IDEMPOTENCY_KEY_LENGTH = 8;

/** Bir sepette izin verilen en fazla kalem sayisi (B27: toplu cagrilarda 50 kalem varsayimi). */
export const MAX_CART_LINES = 50;

/** Bir kalemde izin verilen en fazla adet. */
export const MAX_LINE_QUANTITY = 99;

/** Iptal gerekcesi anahtarinin en uzun hali (ornek: "CHANGED_MIND"). */
export const MAX_CANCEL_REASON_LENGTH = 64;
