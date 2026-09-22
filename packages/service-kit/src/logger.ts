/**
 * Yapilandirilmis gunlukleme (pino uygulamasi).
 *
 * Kural: `console.log` yasaktir (eslint kapisi), her kayit JSON'dur ve baglam
 * alanlari mesajdan ONCE gelir: `logger.info({ orderId }, 'siparis olusturuldu')`.
 *
 * ARAYUZ BURADA DEGIL: `Logger` ve `silentLogger` @getir/core icindedir
 * (T2.5'te tasindi). Sebebi, mongo-kit ve redis-kit'in de bir gunlukcu istemesi;
 * arayuz burada kalsaydi veri katmani paketleri gRPC paketine bagimli olurdu.
 * Bu dosya yalnizca UYGULAMAYI (pino) saglar ve arayuzu yeniden disari verir,
 * boylece cagiran taraflar tek yerden import etmeye devam eder.
 *
 * KAPSAM NOTU: roadmap'te gunlukleme + metrik icin ayri bir `packages/
 * observability` paketi planli (pino logger, request-id, prom-client). O paket
 * acildiginda bu dosya oraya tasinir; arayuz AYNI kalacagi icin cagiran
 * taraflarda degisiklik olmaz. T2.4'te burada duruyor cunku sunucunun
 * acilis/kapanis kayitlarini yazacak bir gunlukcuye simdi ihtiyaci var ve
 * kullanilmayan bir paket acmak gereksiz.
 */

import { pino } from 'pino';

import type { Logger } from '@getir/core';

export type { LogFields, Logger } from '@getir/core';
export { silentLogger } from '@getir/core';

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
