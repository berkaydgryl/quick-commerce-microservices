/**
 * EventPublisher'in Redis Streams uygulamasi (ADR-07): XADD stream:events.
 *
 * Akis MAXLEN ~10000 ile sinirlidir (roadmap Redis semasi). "~" yaklasik
 * kirpmadir: Redis tam sayiya inmek icin her yazimda kirpmaz, dugum boyunda
 * keser - maliyet sabit kalir. Sinir, kalici kayit degil TASIMA icindir:
 * olaylarin kalici kaydi ureten servisin outbox'indadir (ADR-04).
 */

import { AppError } from '@getir/core';
import { EVENTS_STREAM_KEY } from '@getir/redis-kit';
import type { RedisConnection } from '@getir/redis-kit';

import { eventEnvelopeSchema } from './envelope.js';
import type { EventEnvelope } from './envelope.js';
import type { EventPublisher } from './publisher.js';
import { toStreamFields } from './stream-fields.js';

/** Akisin tuttugu en fazla kayit (yaklasik). */
export const EVENTS_STREAM_MAX_LENGTH = 10_000;

export interface RedisStreamsPublisherOptions {
  /** Varsayilan stream:events (redis-kit, tek kaynak). Testler ayri akisa yazar. */
  readonly streamKey?: string;
  readonly maxLength?: number;
}

export class RedisStreamsPublisher implements EventPublisher {
  private readonly streamKey: string;
  private readonly maxLength: number;

  constructor(
    private readonly redis: RedisConnection['redis'],
    options: RedisStreamsPublisherOptions = {},
  ) {
    this.streamKey = options.streamKey ?? EVENTS_STREAM_KEY;
    this.maxLength = options.maxLength ?? EVENTS_STREAM_MAX_LENGTH;
  }

  async publish(envelope: EventEnvelope): Promise<void> {
    // Hatta bozuk zarf girmez: tuketici onu okuyamaz ve tekrar tekrar takilir.
    const parsed = eventEnvelopeSchema.safeParse(envelope);
    if (!parsed.success) {
      throw AppError.internal('Gecersiz olay zarfi', {
        details: { eventId: envelope.eventId, topic: envelope.topic },
      });
    }
    await this.redis.xadd(
      this.streamKey,
      'MAXLEN',
      '~',
      String(this.maxLength),
      '*',
      ...toStreamFields(parsed.data),
    );
  }
}
