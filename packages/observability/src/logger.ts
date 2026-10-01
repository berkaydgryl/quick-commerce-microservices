/**
 * Yapilandirilmis gunlukleme (pino uygulamasi; T10.5'te service-kit'ten tasindi).
 *
 * Kural: `console.log` yasaktir (eslint kapisi), her kayit JSON'dur ve baglam
 * alanlari mesajdan ONCE gelir: `logger.info({ orderId }, 'siparis olusturuldu')`.
 *
 * ARAYUZ BURADA DEGIL: `Logger` ve `silentLogger` @getir/core icindedir (T2.5).
 * mongo-kit ve redis-kit de bir gunlukcu ister; arayuz burada olsaydi veri
 * katmani paketleri bu pakete bagimli olurdu. Bu dosya yalnizca UYGULAMAYI
 * (pino) saglar. service-kit onu yeniden disari verir: servisler
 * `@getir/service-kit`'ten almaya devam eder.
 */

import { pino } from 'pino';

import type { Logger } from '@getir/core';

import { stdoutDestination } from './log-destination.js';

export interface CreateLoggerOptions {
  /** Servis adi; her kayitta `name` alani olarak gorunur. */
  readonly name: string;
  /** trace | debug | info | warn | error | fatal | silent */
  readonly level?: string;
}

/**
 * Servis gunlukcusu uretir. Cikti tek satir JSON'dur (stdout, esli; bkz.
 * log-destination.ts); konteyner gunluklerini toplayan her arac bu bicimi okur.
 * Sure alanlari milisaniyedir.
 */
export function createLogger(options: CreateLoggerOptions): Logger {
  return pino(
    {
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
    },
    stdoutDestination(options.name),
  );
}
