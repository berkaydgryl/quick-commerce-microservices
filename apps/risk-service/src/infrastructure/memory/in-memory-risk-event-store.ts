/**
 * Bellek deposu: MOCK modu ve testler. "En yeni" = evaluatedAt azalan (Mongo
 * ile ayni). Ayni milisaniyedeki iki kaydin sirasini sozlesme VAAT ETMEZ
 * (Mongo'da kimlik sirasina duser); saga'nin iki degerlendirmesi arasinda
 * zaten saniyeler vardir.
 */

import type { RiskEvent } from '../../domain/risk-event.js';
import type { LatestEventQuery, RiskEventRepository } from '../../domain/risk-event-repository.js';

export class InMemoryRiskEventStore implements RiskEventRepository {
  private readonly events: RiskEvent[] = [];

  insert(event: RiskEvent): Promise<void> {
    this.events.push(event);
    return Promise.resolve();
  }

  findLatest({ userId, orderId }: LatestEventQuery): Promise<RiskEvent | null> {
    let latest: RiskEvent | null = null;
    for (const event of this.events) {
      const matches =
        event.userId === userId && (orderId === undefined || event.orderId === orderId);
      if (
        matches &&
        (latest === null || event.evaluatedAt.getTime() >= latest.evaluatedAt.getTime())
      ) {
        latest = event;
      }
    }
    return Promise.resolve(latest);
  }

  /** Yalnizca test icin: kac kayit var. */
  get size(): number {
    return this.events.length;
  }
}
