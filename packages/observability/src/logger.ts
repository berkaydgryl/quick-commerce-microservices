/**
 * Yapilandirilmis gunlukleme (pino uygulamasi; T10.5'te service-kit'ten tasindi).
 *
 * Kural: `console.log` yasaktir (eslint kapisi), her kayit JSON'dur ve baglam
 * alanlari mesajdan ONCE gelir: `logger.info({ orderId }, 'siparis olusturuldu')`.
 *
 * Iz baglami (D15): aktif span'in `traceId` ve `spanId`'si her satira kendiliginden
 * eklenir (pino mixin). Bir RPC'nin butun satirlari - use-case ve giden cagri
 * dahil - iz goruntuleyicideki izle eslesir; span disindaki satir (acilis,
 * isci turu) bu alanlari tasimaz.
 *
 * ARAYUZ BURADA DEGIL: `Logger` ve `silentLogger` @getir/core icindedir (T2.5).
 * mongo-kit ve redis-kit de bir gunlukcu ister; arayuz burada olsaydi veri
 * katmani paketleri bu pakete bagimli olurdu. Bu dosya yalnizca UYGULAMAYI
 * (pino) saglar. service-kit onu yeniden disari verir: servisler
 * `@getir/service-kit`'ten almaya devam eder.
 */

import { isSpanContextValid, trace } from '@opentelemetry/api';
import { pino } from 'pino';

import type { Logger } from '@getir/core';

import { stdoutDestination } from './log-destination.js';
import { censorLogData, LOG_REDACT_PATHS } from './redact.js';

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
      // DIKKAT (T11.17'de dogrulandi): `cause` enumerable olmasa da YAZILIR -
      // pino-std-serializers mesaja ": <cause mesaji>", yigina "caused by: ..."
      // ekler. Gizli veri tasiyabilecek hata (kart saglayicisi) cause'a konmaz.
      formatters: {
        level: (label) => ({ level: label }),
      },
      mixin: traceFields,
      // Kart numarasi ve CVV (T11.17), siparis ayrintisinin kisisel verisi
      // (T12.4): ikinci emniyet, acik yollar (redact.ts).
      redact: { paths: [...LOG_REDACT_PATHS], censor: censorLogData },
    },
    stdoutDestination(options.name),
  );
}

/** Aktif span'in kimlikleri; span yoksa (ya da gecersizse) alan eklenmez. */
export function traceFields(): { traceId?: string; spanId?: string } {
  const spanContext = trace.getActiveSpan()?.spanContext();
  if (spanContext === undefined || !isSpanContextValid(spanContext)) {
    return {};
  }
  return { traceId: spanContext.traceId, spanId: spanContext.spanId };
}
