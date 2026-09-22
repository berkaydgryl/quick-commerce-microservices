/**
 * Yapilandirilmis gunlukleme (pino).
 *
 * Kural: `console.log` yasaktir (eslint kapisi), her kayit JSON'dur ve baglam
 * alanlari mesajdan ONCE gelir: `logger.info({ orderId }, 'siparis olusturuldu')`.
 *
 * NEDEN ARAYUZ VAR: `Logger` pino'nun tipini degil, KULLANDIGIMIZ kadarini
 * tanimlar. Cagiran taraflar (handler'lar, sunucu, ileride repository'ler) bu
 * arayuzu ister; testler tek satirlik bir sahte nesne verebilir ve gunluk
 * kutuphanesi degisirse yalnizca bu dosya degisir.
 *
 * KAPSAM NOTU: roadmap'te gunlukleme + metrik icin ayri bir `packages/
 * observability` paketi planli (pino logger, request-id, prom-client). O paket
 * acildiginda bu dosya oraya tasinir; arayuz AYNI kalacagi icin cagiran
 * taraflarda degisiklik olmaz. T2.4'te burada duruyor cunku sunucunun
 * acilis/kapanis kayitlarini yazacak bir gunlukcuye simdi ihtiyaci var ve
 * kullanilmayan bir paket acmak gereksiz.
 */

import { pino } from 'pino';

/** Gunluk kaydina eklenen yapilandirilmis baglam alanlari. */
export type LogFields = Record<string, unknown>;

/** Kod tabaninin gordugu gunlukcu yuzeyi. */
export interface Logger {
  debug(fields: LogFields, message: string): void;
  info(fields: LogFields, message: string): void;
  warn(fields: LogFields, message: string): void;
  error(fields: LogFields, message: string): void;
  fatal(fields: LogFields, message: string): void;
  /** Verilen alanlari her kayda ekleyen alt gunlukcu (orn. { rpc, requestId }). */
  child(fields: LogFields): Logger;
}

export interface CreateLoggerOptions {
  /** Servis adi; her kayitta `name` alani olarak gorunur. */
  readonly name: string;
  /** trace | debug | info | warn | error | fatal | silent */
  readonly level?: string;
}

/**
 * Servis gunlukcusu uretir. Cikti tek satir JSON'dur (stdout); konteyner
 * gunluklerini toplayan her arac bu bicimi okur. Sure alanlari milisaniyedir.
 */
export function createLogger(options: CreateLoggerOptions): Logger {
  return pino({
    name: options.name,
    level: options.level ?? 'info',
    // Varsayilan `time` alani epoch ms'dir; ISO-8601 insan tarafindan da,
    // arama motorlari tarafindan da dogrudan okunur.
    timestamp: pino.stdTimeFunctions.isoTime,
    // Hata nesneleri `err` alaninda serilestirilir (mesaj + stack + code).
    // AppError'in `cause` alani enumerable olmadigi icin disari sizmaz.
    formatters: {
      level: (label) => ({ level: label }),
    },
  });
}

/**
 * Hicbir sey yazmayan gunlukcu. Testler ve "gunluk istemiyorum" diyen
 * cagirilar icin; uretimde kullanilmaz.
 */
export const silentLogger: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  fatal: () => undefined,
  child: () => silentLogger,
};
