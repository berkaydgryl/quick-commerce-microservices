/**
 * Bellek ici yayinci (ADR-07: "testlerde bellek ici sahte uygulama").
 * Yayinlanan zarflari sirasiyla tutar; ag yok. Redis yayincisi gibi her yazim
 * bir PRODUCER span'idir (D16): MOCK'ta da iz ayni gorunur.
 */

import type { EventEnvelope } from './envelope.js';
import type { EventPublisher } from './publisher.js';
import { MESSAGING_SYSTEM, publishInSpan } from './tracing.js';

export class InMemoryEventPublisher implements EventPublisher {
  readonly published: EventEnvelope[] = [];

  publish(envelope: EventEnvelope): Promise<void> {
    return publishInSpan(envelope, MESSAGING_SYSTEM.MEMORY, (traced) => {
      this.published.push(traced);
      return Promise.resolve();
    });
  }
}
