/**
 * service-kit sabitleri.
 *
 * Buradaki degerler SOZLESMEDIR: metadata anahtarlari gateway (Go) tarafindan
 * da okunur, health servis adi grpcurl ve konteyner probe'lari tarafindan
 * yazilir. Degisirlerse karsi taraf sessizce bozulur; bu yuzden tek yerde
 * isimlendirilmislerdir.
 */

/** Varsayilan dinleme adresi. Konteyner icinde 127.0.0.1 disaridan erisilemez. */
export const DEFAULT_GRPC_HOST = '0.0.0.0';

/**
 * Zarif kapanista, devam eden cagrilarin bitmesi icin beklenen en uzun sure.
 * Sonunda sunucu zorla kapatilir; 10 sn, Kubernetes'in varsayilan 30 sn'lik
 * terminationGracePeriod'u icinde rahatca biter.
 */
export const DEFAULT_SHUTDOWN_TIMEOUT_MS = 10_000;

/**
 * Korelasyon kimliginin tasindigi metadata anahtari.
 * Gateway istegi karsilarken uretir, her gRPC cagrisina koyar; servis logu ve
 * REST cevabindaki `error.requestId` boylece ayni degeri gosterir.
 * gRPC metadata anahtarlari KUCUK HARF olmak zorundadir.
 */
export const REQUEST_ID_METADATA_KEY = 'x-request-id';

/**
 * AppError'in tel uzerindeki tasiyicisi: JSON kodlanmis `AppErrorJson`.
 *
 * NEDEN grpc-status-details-bin DEGIL: standart yol, google.rpc.Status icine
 * Any olarak gomulu bir mesaj tasimaktir; bu, hata ureten her tarafin
 * protobuf kodlayici tasimasini gerektirir ve service-kit'i @getir/proto'ya
 * baglardi. Tasidigimiz sey zaten sabit ve kucuk bir sozluk (code, message,
 * details, requestId), bu yuzden duz JSON hem Node hem Go tarafinda tek
 * satirda okunur.
 */
export const ERROR_METADATA_KEY = 'x-app-error';

/** Standart health servisinin tam adi (grpcurl bu adi yazar). */
export const HEALTH_SERVICE_NAME = 'grpc.health.v1.Health';

/**
 * Health sorgularinda SUNUCUNUN BUTUNUNU temsil eden anahtar.
 * Standart boyle tanimlar: bos string = "butun sunucu ayakta mi?".
 */
export const OVERALL_HEALTH_KEY = '';

/**
 * ServingStatus degerleri.
 *
 * Metin olarak tutuluyorlar cunku proto-loader `enums: String` ile yuklenir:
 * boylece hem log hem grpcurl ciktisinda 1 yerine "SERVING" gorunur.
 */
export const SERVING_STATUS = {
  UNKNOWN: 'UNKNOWN',
  SERVING: 'SERVING',
  NOT_SERVING: 'NOT_SERVING',
  /** Yalnizca Watch akisinda: sorulan servis bu sunucuda kayitli degil. */
  SERVICE_UNKNOWN: 'SERVICE_UNKNOWN',
} as const;

export type ServingStatus = (typeof SERVING_STATUS)[keyof typeof SERVING_STATUS];
