/**
 * Uygulama genelinde tek hata tipi: AppError.
 *
 * Kural: servis sinirindan disari cikan her hata bir AppError'dur. Boylece
 * gateway HTTP durumunu, gRPC katmani status kodunu tek tabloyu okuyarak secer.
 */

import { ERROR_CODES, grpcStatusFor, httpStatusFor } from './error-codes.js';
import type { ErrorCode, GrpcStatus, HttpStatus } from './error-codes.js';

/** AppError kurucusunun istege bagli alanlari. */
export interface AppErrorOptions {
  /** Istemciye gosterilebilecek ek baglam (alan listesi, sku, vb.). */
  readonly details?: unknown;
  /** Sarmalanan asil hata; sadece sunucu loglarina gider. */
  readonly cause?: unknown;
  /** Istegi uctan uca izlemek icin korelasyon kimligi. */
  readonly requestId?: string;
}

/**
 * AppError'in tel uzerindeki (JSON) gosterimi.
 * Yigin izi (stack) ve cause bilincli olarak DISARI VERILMEZ.
 */
export interface AppErrorJson {
  code: ErrorCode;
  message: string;
  details?: unknown;
  requestId?: string;
}

const DEFAULT_MESSAGES = {
  VALIDATION_FAILED: 'Gecersiz istek',
  UNAUTHORIZED: 'Kimlik dogrulanamadi',
  FORBIDDEN: 'Bu islem icin yetkiniz yok',
  NOT_FOUND: 'Kayit bulunamadi',
  CONFLICT: 'Islem cakisti, tekrar deneyin',
  INTERNAL: 'Beklenmeyen bir hata olustu',
} as const;

export class AppError extends Error {
  /** Makine tarafindan okunan hata kodu. */
  readonly code: ErrorCode;
  /** Istemciye gosterilebilecek ek baglam (yoksa undefined). */
  readonly details: unknown;
  /** Korelasyon kimligi (yoksa undefined). */
  readonly requestId: string | undefined;

  constructor(code: ErrorCode, message: string, options: AppErrorOptions = {}) {
    super(message);
    // Error alt siniflarinda prototip zinciri derleme hedefine gore kopabilir.
    Object.setPrototypeOf(this, new.target.prototype);
    this.name = 'AppError';
    this.code = code;
    this.details = options.details;
    this.requestId = options.requestId;

    // `cause` ES2022 standardi; lib farkliliklarindan etkilenmemek icin
    // dogrudan tanimlaniyor. Enumerable degil -> kazara serilestirilemez.
    if (options.cause !== undefined) {
      Object.defineProperty(this, 'cause', {
        value: options.cause,
        enumerable: false,
        writable: true,
        configurable: true,
      });
    }
  }

  /** Hata kodunun HTTP karsiligi. */
  get httpStatus(): HttpStatus {
    return httpStatusFor(this.code);
  }

  /** Hata kodunun gRPC karsiligi. */
  get grpcStatus(): GrpcStatus {
    return grpcStatusFor(this.code);
  }

  /** Girdi dogrulamasi basarisiz. */
  static validation(
    message: string = DEFAULT_MESSAGES.VALIDATION_FAILED,
    options: AppErrorOptions = {},
  ): AppError {
    return new AppError(ERROR_CODES.VALIDATION_FAILED, message, options);
  }

  /** Durum cakismasi / es zamanli degisiklik. */
  static conflict(
    message: string = DEFAULT_MESSAGES.CONFLICT,
    options: AppErrorOptions = {},
  ): AppError {
    return new AppError(ERROR_CODES.CONFLICT, message, options);
  }

  /** Beklenmeyen sunucu hatasi. */
  static internal(
    message: string = DEFAULT_MESSAGES.INTERNAL,
    options: AppErrorOptions = {},
  ): AppError {
    return new AppError(ERROR_CODES.INTERNAL, message, options);
  }

  /** Kayit bulunamadi. */
  static notFound(
    message: string = DEFAULT_MESSAGES.NOT_FOUND,
    options: AppErrorOptions = {},
  ): AppError {
    return new AppError(ERROR_CODES.NOT_FOUND, message, options);
  }

  /** Kimlik dogrulandi ama bu islem icin yetki yok. */
  static forbidden(
    message: string = DEFAULT_MESSAGES.FORBIDDEN,
    options: AppErrorOptions = {},
  ): AppError {
    return new AppError(ERROR_CODES.FORBIDDEN, message, options);
  }

  /** Kimlik dogrulanamadi. */
  static unauthorized(
    message: string = DEFAULT_MESSAGES.UNAUTHORIZED,
    options: AppErrorOptions = {},
  ): AppError {
    return new AppError(ERROR_CODES.UNAUTHORIZED, message, options);
  }

  /**
   * Tel uzerinde tasinacak gosterim.
   * Yigin izi (stack) ve cause ASLA buraya girmez - bilgi sizintisi olur.
   */
  toJSON(): AppErrorJson {
    const json: AppErrorJson = { code: this.code, message: this.message };
    if (this.details !== undefined) {
      json.details = this.details;
    }
    if (this.requestId !== undefined) {
      json.requestId = this.requestId;
    }
    return json;
  }
}

/** Tip daraltan AppError kontrolu. */
export function isAppError(value: unknown): value is AppError {
  return value instanceof AppError;
}

/**
 * Bilinmeyen bir hatayi AppError'a cevirir; zaten AppError ise oldugu gibi birakir.
 * Beklenmeyen hatalarin mesaji disari sizmasin diye INTERNAL varsayilani kullanilir.
 */
export function toAppError(value: unknown, options: AppErrorOptions = {}): AppError {
  if (isAppError(value)) {
    return value;
  }
  return AppError.internal(DEFAULT_MESSAGES.INTERNAL, { ...options, cause: value });
}
