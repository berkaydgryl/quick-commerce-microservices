/**
 * Bellek deposu: MOCK modu ve testler. "En yeni" = evaluatedAt azalan (Mongo
 * ile ayni). Ayni milisaniyedeki iki kaydin sirasini sozlesme VAAT ETMEZ
 * (Mongo'da kimlik sirasina duser); ayni kullanicinin iki degerlendirmesi (iki siparis) arasinda
 * zaten saniyeler vardir.
 */

import type { RiskEvent } from '../../domain/risk-event.js';
import type {
  LatestEventQuery,
  RecentEventsQuery,
  RecentRiskEvents,
  RiskEventRepository,
} from '../../domain/risk-event-repository.js';

export class InMemoryRiskEventStore implements RiskEventRepository, RecentRiskEvents {
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

  findHighestRecent({ userId, since }: RecentEventsQuery): Promise<RiskEvent | null> {
    let highest: RiskEvent | null = null;
    for (const event of this.events) {
      if (event.userId !== userId || event.evaluatedAt < since) continue;
      if (highest === null || ranksAbove(event, highest)) highest = event;
    }
    return Promise.resolve(highest);
  }

  /** Yalnizca test icin: kac kayit var. */
  get size(): number {
    return this.events.length;
  }
}

/**
 * Mongo'nun `highestRecentQuery` siralamasinin AYNISI (bellek ve Mongo ayni kaydi
 * secer): vetoedByRuleId azalan (eksik alan her metinden kucuk), skor azalan,
 * zaman azalan, kimlik azalan.
 */
function ranksAbove(candidate: RiskEvent, current: RiskEvent): boolean {
  return (
    (compareDescending(candidate.vetoedByRuleId, current.vetoedByRuleId) ||
      candidate.score - current.score ||
      candidate.evaluatedAt.getTime() - current.evaluatedAt.getTime() ||
      compareDescending(candidate.id, current.id)) > 0
  );
}

/** Pozitif: soldaki once gelir. Eksik deger (undefined) her metinden kucuktur. */
function compareDescending(left: string | undefined, right: string | undefined): number {
  if (left === right) return 0;
  if (left === undefined) return -1;
  if (right === undefined) return 1;
  return left > right ? 1 : -1;
}
