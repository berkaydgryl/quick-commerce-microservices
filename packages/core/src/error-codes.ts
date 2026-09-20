/**
 * Hata kodu sozlugu ve protokol karsiliklari.
 *
 * TEK KAYNAK: bir hata kodunun HTTP ve gRPC karsiligi baska hicbir yerde
 * tanimlanmaz. Gateway (HTTP) ve servisler (gRPC) bu tablolari okur, boylece
 * ayni is hatasi her iki protokolde de ayni anlama gelir.
 */

export const ERROR_CODES = {
  /** Girdi dogrulamasi basarisiz (zod / is kurali on kosulu). */
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  /** Kimlik dogrulanamadi (token yok / gecersiz / suresi dolmus). */
  UNAUTHORIZED: 'UNAUTHORIZED',
  /** Kimlik var ama yetki yok. */
  FORBIDDEN: 'FORBIDDEN',
  /** Kayit bulunamadi. */
  NOT_FOUND: 'NOT_FOUND',
  /** Es zamanli degisiklik / durum cakismasi. */
  CONFLICT: 'CONFLICT',
  /** Beklenmeyen sunucu hatasi. */
  INTERNAL: 'INTERNAL',
  /** Talep edilen miktar icin yeterli stok yok. */
  STOCK_INSUFFICIENT: 'STOCK_INSUFFICIENT',
  /** Rezervasyon TTL suresi dolmus, stok geri birakilmis. */
  RESERVATION_EXPIRED: 'RESERVATION_EXPIRED',
  /** Kullanicinin halihazirda aktif bir rezervasyonu var. */
  RESERVATION_ACTIVE: 'RESERVATION_ACTIVE',
  /** Risk motoru islemi tamamen engelledi (CRITICAL bant). */
  RISK_BLOCKED: 'RISK_BLOCKED',
  /** Risk motoru manuel inceleme istedi (HIGH bant). */
  RISK_REVIEW: 'RISK_REVIEW',
  /** Odeme saglayicisi islemi reddetti. */
  PAYMENT_DECLINED: 'PAYMENT_DECLINED',
  /** 3DS dogrulamasi tamamlanamadi. */
  THREEDS_FAILED: 'THREEDS_FAILED',
  /** Sepet fiyati rezervasyondan sonra degisti. */
  PRICE_CHANGED: 'PRICE_CHANGED',
  /** Kupon gecersiz, suresi dolmus veya kullanilamaz. */
  COUPON_INVALID: 'COUPON_INVALID',
  /** Minimum sepet tutari saglanmadi. */
  MIN_BASKET_NOT_MET: 'MIN_BASKET_NOT_MET',
  /** Adresi kapsayan acik magaza yok. */
  NO_STORE: 'NO_STORE',
  /** Ayni idempotency anahtari ile bir istek halen islemde. */
  REQUEST_IN_PROGRESS: 'REQUEST_IN_PROGRESS',
  /** Hiz siniri asildi. */
  RATE_LIMITED: 'RATE_LIMITED',
  /** Siparis durum makinesinde tanimsiz gecis denendi (ornegin PAID siparise Reserve). */
  ORDER_STATE_INVALID: 'ORDER_STATE_INVALID',
  /** Odeme 3DS dogrulamasi ister; istemci /3ds adimina yonlenir. */
  THREEDS_REQUIRED: 'THREEDS_REQUIRED',
  /** Bagimli bir servis su an cevap veremiyor (gecici). */
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

/** Kullanilan HTTP durum kodlari (sihirli sayi birakmamak icin isimlendirildi). */
export const HTTP_STATUS = {
  OK: 200,
  ACCEPTED: 202,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  PAYMENT_REQUIRED: 402,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  GONE: 410,
  UNPROCESSABLE_ENTITY: 422,
  TOO_MANY_REQUESTS: 429,
  INTERNAL_SERVER_ERROR: 500,
  SERVICE_UNAVAILABLE: 503,
} as const;

export type HttpStatus = (typeof HTTP_STATUS)[keyof typeof HTTP_STATUS];

/** Standart gRPC durum kodlari (grpc-status). */
export const GRPC_STATUS = {
  OK: 0,
  CANCELLED: 1,
  UNKNOWN: 2,
  INVALID_ARGUMENT: 3,
  DEADLINE_EXCEEDED: 4,
  NOT_FOUND: 5,
  ALREADY_EXISTS: 6,
  PERMISSION_DENIED: 7,
  RESOURCE_EXHAUSTED: 8,
  FAILED_PRECONDITION: 9,
  ABORTED: 10,
  OUT_OF_RANGE: 11,
  UNIMPLEMENTED: 12,
  INTERNAL: 13,
  UNAVAILABLE: 14,
  DATA_LOSS: 15,
  UNAUTHENTICATED: 16,
} as const;

export type GrpcStatus = (typeof GRPC_STATUS)[keyof typeof GRPC_STATUS];

/** Hata kodu -> HTTP durum kodu. */
export const ERROR_CODE_HTTP_STATUS: Readonly<Record<ErrorCode, HttpStatus>> = {
  [ERROR_CODES.VALIDATION_FAILED]: HTTP_STATUS.BAD_REQUEST,
  [ERROR_CODES.UNAUTHORIZED]: HTTP_STATUS.UNAUTHORIZED,
  [ERROR_CODES.FORBIDDEN]: HTTP_STATUS.FORBIDDEN,
  [ERROR_CODES.NOT_FOUND]: HTTP_STATUS.NOT_FOUND,
  [ERROR_CODES.CONFLICT]: HTTP_STATUS.CONFLICT,
  [ERROR_CODES.INTERNAL]: HTTP_STATUS.INTERNAL_SERVER_ERROR,
  [ERROR_CODES.STOCK_INSUFFICIENT]: HTTP_STATUS.CONFLICT,
  // Rezervasyon vardi ama artik yok: "Gone" en dogru anlami tasir.
  [ERROR_CODES.RESERVATION_EXPIRED]: HTTP_STATUS.GONE,
  [ERROR_CODES.RESERVATION_ACTIVE]: HTTP_STATUS.CONFLICT,
  [ERROR_CODES.RISK_BLOCKED]: HTTP_STATUS.FORBIDDEN,
  // Inceleme: istek kabul edildi, karar asenkron verilecek.
  [ERROR_CODES.RISK_REVIEW]: HTTP_STATUS.ACCEPTED,
  [ERROR_CODES.PAYMENT_DECLINED]: HTTP_STATUS.PAYMENT_REQUIRED,
  [ERROR_CODES.THREEDS_FAILED]: HTTP_STATUS.PAYMENT_REQUIRED,
  [ERROR_CODES.PRICE_CHANGED]: HTTP_STATUS.CONFLICT,
  [ERROR_CODES.COUPON_INVALID]: HTTP_STATUS.UNPROCESSABLE_ENTITY,
  [ERROR_CODES.MIN_BASKET_NOT_MET]: HTTP_STATUS.UNPROCESSABLE_ENTITY,
  [ERROR_CODES.NO_STORE]: HTTP_STATUS.NOT_FOUND,
  [ERROR_CODES.REQUEST_IN_PROGRESS]: HTTP_STATUS.CONFLICT,
  [ERROR_CODES.RATE_LIMITED]: HTTP_STATUS.TOO_MANY_REQUESTS,
  [ERROR_CODES.ORDER_STATE_INVALID]: HTTP_STATUS.CONFLICT,
  // 3DS gerekliligi bir "hata" degil, akisin devami: istemci /3ds adimina gider.
  [ERROR_CODES.THREEDS_REQUIRED]: HTTP_STATUS.PAYMENT_REQUIRED,
  [ERROR_CODES.SERVICE_UNAVAILABLE]: HTTP_STATUS.SERVICE_UNAVAILABLE,
};

/** Hata kodu -> gRPC durum kodu. */
export const ERROR_CODE_GRPC_STATUS: Readonly<Record<ErrorCode, GrpcStatus>> = {
  [ERROR_CODES.VALIDATION_FAILED]: GRPC_STATUS.INVALID_ARGUMENT,
  [ERROR_CODES.UNAUTHORIZED]: GRPC_STATUS.UNAUTHENTICATED,
  [ERROR_CODES.FORBIDDEN]: GRPC_STATUS.PERMISSION_DENIED,
  [ERROR_CODES.NOT_FOUND]: GRPC_STATUS.NOT_FOUND,
  [ERROR_CODES.CONFLICT]: GRPC_STATUS.ABORTED,
  [ERROR_CODES.INTERNAL]: GRPC_STATUS.INTERNAL,
  [ERROR_CODES.STOCK_INSUFFICIENT]: GRPC_STATUS.FAILED_PRECONDITION,
  [ERROR_CODES.RESERVATION_EXPIRED]: GRPC_STATUS.FAILED_PRECONDITION,
  [ERROR_CODES.RESERVATION_ACTIVE]: GRPC_STATUS.ALREADY_EXISTS,
  [ERROR_CODES.RISK_BLOCKED]: GRPC_STATUS.PERMISSION_DENIED,
  [ERROR_CODES.RISK_REVIEW]: GRPC_STATUS.FAILED_PRECONDITION,
  [ERROR_CODES.PAYMENT_DECLINED]: GRPC_STATUS.FAILED_PRECONDITION,
  [ERROR_CODES.THREEDS_FAILED]: GRPC_STATUS.FAILED_PRECONDITION,
  [ERROR_CODES.PRICE_CHANGED]: GRPC_STATUS.ABORTED,
  [ERROR_CODES.COUPON_INVALID]: GRPC_STATUS.INVALID_ARGUMENT,
  [ERROR_CODES.MIN_BASKET_NOT_MET]: GRPC_STATUS.FAILED_PRECONDITION,
  [ERROR_CODES.NO_STORE]: GRPC_STATUS.NOT_FOUND,
  [ERROR_CODES.REQUEST_IN_PROGRESS]: GRPC_STATUS.ABORTED,
  [ERROR_CODES.RATE_LIMITED]: GRPC_STATUS.RESOURCE_EXHAUSTED,
  [ERROR_CODES.ORDER_STATE_INVALID]: GRPC_STATUS.FAILED_PRECONDITION,
  [ERROR_CODES.THREEDS_REQUIRED]: GRPC_STATUS.FAILED_PRECONDITION,
  [ERROR_CODES.SERVICE_UNAVAILABLE]: GRPC_STATUS.UNAVAILABLE,
};

/** Hata kodunun HTTP karsiligi. */
export function httpStatusFor(code: ErrorCode): HttpStatus {
  return ERROR_CODE_HTTP_STATUS[code];
}

/** Hata kodunun gRPC karsiligi. */
export function grpcStatusFor(code: ErrorCode): GrpcStatus {
  return ERROR_CODE_GRPC_STATUS[code];
}

/** Disaridan gelen bir degerin bilinen hata kodu olup olmadigini dogrular. */
export function isErrorCode(value: unknown): value is ErrorCode {
  return (
    typeof value === 'string' && Object.prototype.hasOwnProperty.call(ERROR_CODE_HTTP_STATUS, value)
  );
}
