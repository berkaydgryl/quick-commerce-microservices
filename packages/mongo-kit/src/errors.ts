/**
 * Mongo hatasi -> AppError cevirisi. TEK YER burasidir.
 *
 * Neden: surucunun firlattigi hata sinifi (MongoServerError, kod 11000...)
 * servis sinirindan disari cikmamali. Cikarsa gateway onu INTERNAL'a cevirir
 * ve "bu kayit zaten var" gibi anlasilir bir durum, 500 olarak gorunur.
 */

import { AppError, ERROR_CODES } from '@getir/core';
import {
  MongoError,
  MongoErrorLabel,
  MongoNetworkError,
  MongoServerError,
  MongoServerSelectionError,
} from 'mongodb';

/** Benzersiz indeks ihlali; Mongo bunu tek bir kodla bildirir. */
const DUPLICATE_KEY_CODE = 11_000;

/**
 * Transaction icinde ayni belgeye es zamanli yazim (WriteConflict). Surucu
 * bunu normalde kendisi yeniden dener (retryableTransactionCause); buraya
 * ancak deneme suresi dolarsa ulasir. Es zamanli degisiklik = CONFLICT.
 */
const WRITE_CONFLICT_CODE = 112;

export interface MongoErrorContext {
  /** Hangi islem: "insertOne", "findById"... */
  readonly operation?: string;
  readonly collection?: string;
}

/**
 * Herhangi bir Mongo hatasini AppError'a cevirir.
 *
 * - benzersiz indeks ihlali -> CONFLICT (cagiran taraf yeniden deneyebilir)
 * - transaction yazim cakismasi (WriteConflict) -> CONFLICT
 * - ag / sunucu secimi hatasi -> SERVICE_UNAVAILABLE (gecici, yeniden denenebilir)
 * - digerleri -> INTERNAL (mesaji disari sizmaz)
 */
export function toMongoAppError(error: unknown, context: MongoErrorContext = {}): AppError {
  // ZATEN cevrilmis hata oldugu gibi gecer. Ornek: repository.run() icindeki
  // benzersiz indeks ihlali CONFLICT'e cevrilir, sonra withTransaction ayni
  // hatayi yakalayip buraya TEKRAR verir. Bu satir olmadan CONFLICT, INTERNAL
  // olarak yeniden sarilir ve transaction icindeki her hata kodunu kaybederdi
  // (T4.1'de catalog seed testinde yakalandi).
  if (error instanceof AppError) {
    return error;
  }

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

  if (error instanceof MongoServerError && error.code === WRITE_CONFLICT_CODE) {
    return AppError.conflict('Kayit ayni anda baska bir islemle degisti', {
      details,
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

/**
 * Surucunun YENIDEN DENEYECEGI transaction hatasi; yoksa undefined.
 *
 * NEDEN (T7.3'te bulundu): session.withTransaction geri cagriyi yalnizca
 * TransientTransactionError / UnknownTransactionCommitResult etiketli
 * MongoError'da tekrar calistirir. repository.run() ise her surucu hatasini
 * ANINDA AppError'a cevirir; etiket kaybolur, tekrar deneme hic olmaz ve
 * es zamanli iki yazimin kaybedeni surum cakismasi (CONFLICT) yerine
 * INTERNAL alir. Bu fonksiyon AppError'in `cause`'undaki asil hatayi bulur;
 * withTransaction onu surucuye geri verir.
 */
export function retryableTransactionCause(error: unknown): MongoError | undefined {
  const candidate: unknown = error instanceof AppError ? error.cause : error;
  if (!(candidate instanceof MongoError)) {
    return undefined;
  }
  const retryable =
    candidate.hasErrorLabel(MongoErrorLabel.TransientTransactionError) ||
    candidate.hasErrorLabel(MongoErrorLabel.UnknownTransactionCommitResult);
  return retryable ? candidate : undefined;
}
