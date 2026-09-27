/**
 * Siparis servisinin sabitleri.
 */

/** Gunlukte ve acilis kaydinda gorunen kisa ad. */
export const SERVICE_NAME = 'order';

/** Health tablosunda ve grpcurl cagrilarinda kullanilan tam nitelikli ad. */
export const ORDER_SERVICE_FULL_NAME = 'getir.order.v1.OrderService';

/** Roadmap'teki port haritasindan: order 50053. */
export const DEFAULT_ORDER_GRPC_PORT = 50_053;

// Idempotency anahtari ve sepet sinirlari burada TEKRAR YAZILMAZ: REST sozlesmesiyle
// ayni kaynaktan (@getir/contracts) gelir; iki kapida iki farkli sinir olmasin.

/** Iptal gerekcesi anahtarinin en uzun hali (ornek: "CHANGED_MIND"). */
export const MAX_CANCEL_REASON_LENGTH = 64;
