/**
 * Yayin arayuzu (ADR-07). Servis kodu yalnizca bunu gorur; tasima (bugun Redis
 * Streams, ileride Kafka) fabrikada secilir.
 *
 * Dinleme tarafi (subscribe, tuketici grubu, onay, yeniden teslim) T7.4'te bu
 * pakete eklenir; yayin T7.3'te outbox yayincisi icin gerekiyordu.
 */

import type { EventEnvelope } from './envelope.js';

export interface EventPublisher {
  /**
   * Olayi hatta yazar. Basari = olay KALICI olarak hatta. Hata firlatirsa olay
   * yazilmamis sayilir ve cagiran (outbox yayincisi) tekrar dener.
   */
  publish(envelope: EventEnvelope): Promise<void>;
}
