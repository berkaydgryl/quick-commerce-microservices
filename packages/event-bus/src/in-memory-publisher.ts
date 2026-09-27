/**
 * Bellek ici yayinci (ADR-07: "testlerde bellek ici sahte uygulama").
 * Yayinlanan zarflari sirasiyla tutar; ag yok.
 */

import type { EventEnvelope } from './envelope.js';
import type { EventPublisher } from './publisher.js';

export class InMemoryEventPublisher implements EventPublisher {
  readonly published: EventEnvelope[] = [];

  publish(envelope: EventEnvelope): Promise<void> {
    this.published.push(envelope);
    return Promise.resolve();
  }
}
