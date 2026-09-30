/**
 * Sayac kumesinin isareti Redis'te (T10.1 PR 2, ADR-17): stock:seeded.
 * Degeri son seed'in zamani (tanilama icin); varligi yeterlidir. TTL'sizdir.
 */

import { systemClock } from '@getir/core';
import type { Clock } from '@getir/core';
import type { RedisConnection } from '@getir/redis-kit';
import { STOCK_SEEDED_MARKER_KEY } from '@getir/redis-kit';

import type { CounterSetMarker } from '../../domain/stock.js';

export class RedisCounterSetMarker implements CounterSetMarker {
  constructor(
    private readonly redis: RedisConnection['redis'],
    private readonly clock: Clock = systemClock,
  ) {}

  async isPresent(): Promise<boolean> {
    return (await this.redis.exists(STOCK_SEEDED_MARKER_KEY)) === 1;
  }

  async markPresent(): Promise<void> {
    await this.redis.set(STOCK_SEEDED_MARKER_KEY, this.clock.date().toISOString());
  }
}
