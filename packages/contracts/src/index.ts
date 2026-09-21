/**
 * @getir/contracts - REST ve socket yuzeyinin tek kaynagi.
 *
 * Bu paket Zod semalari tutar; TypeScript tipleri semalardan z.infer ile
 * turer (ADR-10). Ayni sekli bir kez sema bir kez interface olarak yazmak
 * yasaktir, cunku ikisi zamanla kacinilmaz olarak birbirinden ayrilir.
 *
 * Web uygulamasi ve Node servisleri bu paketi dogrudan import eder. Go ile
 * yazilan gateway import edemez; o, ayni sozlesmeyi docs/api/openapi.yaml
 * uzerinden izler ve iki yuzey elle hizali tutulur (ADR-09'daki kabul edilen
 * borc).
 *
 * Bu pakette IS MANTIGI YOKTUR: fiyat hesabi, risk karari ya da durum gecisi
 * burada bulunmaz. Yalnizca "bu ucun govdesi neye benziyor" sorusunu
 * cevaplar.
 */

export * from './constants.js';
export * from './common.js';
export * from './envelope.js';
export * from './errors.js';
export * from './auth.js';
export * from './catalog.js';
export * from './cart.js';
export * from './order.js';
export * from './socket.js';
