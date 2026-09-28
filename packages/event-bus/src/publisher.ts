/**
 * Yayin arayuzu (ADR-07). Servis kodu yalnizca bunu gorur; tasima (bugun Redis
 * Streams, ileride Kafka) fabrikada secilir. Dinleme tarafi subscriber.ts'tedir
 * (T7.4).
 */

import type { EventEnvelope } from './envelope.js';

export interface EventPublisher {
  /**
   * Olayi hatta yazar. Basari = olay KALICI olarak hatta. Hata firlatirsa olay
   * yazilmamis sayilir ve cagiran (outbox yayincisi) tekrar dener.
   */
  publish(envelope: EventEnvelope): Promise<void>;
}
