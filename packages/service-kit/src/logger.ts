/**
 * Gunlukcu: uygulama packages/observability'ye tasindi (T10.5).
 *
 * Bu dosya eski import yolunu korur: servisler `createLogger`'i
 * `@getir/service-kit`'ten almaya devam eder, paket ici dosyalar `Logger`
 * tipini buradan alir. Arayuz (`Logger`, `silentLogger`) @getir/core'dadir.
 */

export { createLogger } from '@getir/observability';
export type { CreateLoggerOptions } from '@getir/observability';
export type { LogFields, Logger } from '@getir/core';
export { silentLogger } from '@getir/core';
