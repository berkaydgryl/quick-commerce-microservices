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
 * Zarif kapanista `onShutdown` kancasina (isciler, Mongo/Redis) taninan en uzun
 * sure (#56). Asilirsa beklenmez, kapanis biter ve surec cikar: takilmis bir
 * baglanti kapanisi sureci sonsuza dek ayakta tutmasin. Kapanisin ust siniri
 * boylece GRPC_SHUTDOWN_TIMEOUT_MS + metrik ucu (1 sn) + bu sure olur; 10 sn
 * varsayilanlarla 21 sn, Kubernetes'in 30 sn'lik penceresinin icinde.
 */
export const DEFAULT_SHUTDOWN_HOOK_TIMEOUT_MS = 10_000;

/**
 * Metrik ucunun portu: gRPC portu + bu fark (roadmap port haritasi; catalog
 * 50051 -> 51051). Ayri ortam degiskeni yoktur: kural sabit, portu tahmin edilir.
 */
export const METRICS_PORT_OFFSET = 1_000;

/**
 * Korelasyon kimliginin tasindigi metadata anahtari. Tanim (ve "gelen degeri
 * kullan, yoksa uret" kurali) T10.5'te @getir/observability'ye tasindi;
 * buradan da disari verilir (eski import yollari).
 */
export { REQUEST_ID_METADATA_KEY } from '@getir/observability';

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
