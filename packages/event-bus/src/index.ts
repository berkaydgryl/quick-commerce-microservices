/**
 * @getir/event-bus - servisler arasi olay hatti (ADR-04, ADR-07).
 *
 * Servis kodu Redis'i dogrudan cagirmaz; EventPublisher ve EventSubscriber
 * arayuzlerini gorur. T7.3: zarf + yayin. T7.4: dinleme (tuketici grubu,
 * onay, yeniden teslim, olu olaylar). D16: zarfta korelasyon (requestId,
 * traceparent) ve olay hattinda iz (yayin ve isleme span'leri).
 *
 * Grup dongusu, tek kaydin karari ve Redis komutlari (group-worker, dispatch,
 * redis-stream-group) paket ICIDIR; disari yalnizca arayuz ve fabrika acilir.
 */

export * from './envelope.js';
export * from './publisher.js';
export * from './subscriber.js';
export * from './stream-fields.js';
export * from './dead-letter.js';
export * from './delivery-settings.js';
export * from './redis-streams-publisher.js';
export * from './redis-streams-consumer.js';
export * from './in-memory-publisher.js';
export { MESSAGING_ATTRIBUTES, MESSAGING_SYSTEM } from './tracing.js';
export type { MessagingSystem } from './tracing.js';
