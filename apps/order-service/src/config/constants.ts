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

/** Catalog'un varsayilan adresi (roadmap port haritasi: catalog 50051). */
export const DEFAULT_CATALOG_GRPC_ADDR = 'localhost:50051';

/**
 * order -> catalog cagrisinin sure siniri (ms). Taslak acma kullanicinin
 * bekledigi yoldadir: catalog takilirsa SERVICE_UNAVAILABLE ile hizli donmek,
 * gateway'in kendi 5 sn'lik sinirina (GATEWAY_REQUEST_TIMEOUT_MS) takilmaktan iyidir.
 */
export const CATALOG_CALL_TIMEOUT_MS = 2_000;

/**
 * Kupon kodunun en uzun hali. Bilinmeyen kod zaten COUPON_INVALID alir; sinir
 * sinirsiz metnin kapidan gecmemesi icindir. REST karsiligi T7.5'te ayni degeri alir.
 */
export const MAX_COUPON_CODE_LENGTH = 32;

/** Iptal gerekcesi anahtarinin en uzun hali (ornek: "CHANGED_MIND"). */
export const MAX_CANCEL_REASON_LENGTH = 64;
