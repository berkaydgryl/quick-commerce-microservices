/**
 * Mongo hatasi -> AppError cevirisi. TEK YER burasidir.
 *
 * Neden: surucunun firlattigi hata sinifi (MongoServerError, kod 11000...)
 * servis sinirindan disari cikmamali. Cikarsa gateway onu INTERNAL'a cevirir
 * ve "bu kayit zaten var" gibi anlasilir bir durum, 500 olarak gorunur.
 */

import { AppError, ERROR_CODES } from '@getir/core';
import { MongoNetworkError, MongoServerError, MongoServerSelectionError } from 'mongodb';

/** Benzersiz indeks ihlali; Mongo bunu tek bir kodla bildirir. */
const DUPLICATE_KEY_CODE = 11_000;

export interface MongoErrorContext {
  /** Hangi islem: "insertOne", "findById"... */
  readonly operation?: string;
  readonly collection?: string;
}

/**
 * Herhangi bir Mongo hatasini AppError'a cevirir.
 *
 * - benzersiz indeks ihlali -> CONFLICT (cagiran taraf yeniden deneyebilir)
 * - ag / sunucu secimi hatasi -> SERVICE_UNAVAILABLE (gecici, yeniden denenebilir)
 * - digerleri -> INTERNAL (mesaji disari sizmaz)
 */
export function toMongoAppError(error: unknown, context: MongoErrorContext = {}): AppError {
  const details: Record<string, string> = {};
  if (context.operation !== undefined) {
    details.operation = context.operation;
  }
  if (context.collection !== undefined) {
    details.collection = context.collection;
  }

  if (error instanceof MongoServerError && error.code === DUPLICATE_KEY_CODE) {
    // keyPattern hangi indeksin ihlal edildigini soyler (orn. { sku: 1 }).
    // Deger DEGIL, yalnizca alan adlari disari verilir. Surucu bu alani `any`
    // olarak tipler; daraltmadan kullanmak tip guvenligini kaybettirir.
    const keyPattern: unknown = error.keyPattern;
    const fields =
      typeof keyPattern === 'object' && keyPattern !== null
        ? Object.keys(keyPattern).join(', ')
        : '';
    return AppError.conflict('Kayit zaten var', {
      details: fields === '' ? details : { ...details, fields },
      cause: error,
    });
  }

  if (error instanceof MongoServerSelectionError || error instanceof MongoNetworkError) {
    return new AppError(ERROR_CODES.SERVICE_UNAVAILABLE, 'Veritabanina ulasilamiyor', {
      details,
      cause: error,
    });
  }

  return AppError.internal('Veritabani islemi basarisiz', { details, cause: error });
}

/** Deger, benzersiz indeks ihlali mi? (upsert yerine "varsa gec" akislari icin.) */
export function isDuplicateKeyError(error: unknown): boolean {
  return error instanceof MongoServerError && error.code === DUPLICATE_KEY_CODE;
}
