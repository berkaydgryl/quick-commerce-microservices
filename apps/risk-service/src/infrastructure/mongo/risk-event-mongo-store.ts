/**
 * RiskEventRepository'nin Mongo uygulamasi. Sorgu yazmaz (risk-events-collection.ts);
 * bellek deposuyla ayni sozlesme testinden gecer.
 */

import type { RiskEvent } from '../../domain/risk-event.js';
import type { LatestEventQuery, RiskEventRepository } from '../../domain/risk-event-repository.js';
import { fromRiskEventDocument, toRiskEventDocument } from './mappers.js';
import type { RiskEventsCollection } from './risk-events-collection.js';

export class RiskEventMongoStore implements RiskEventRepository {
  constructor(private readonly events: RiskEventsCollection) {}

  async insert(event: RiskEvent): Promise<void> {
    await this.events.insertOne(toRiskEventDocument(event));
  }

  async findLatest({ userId, orderId }: LatestEventQuery): Promise<RiskEvent | null> {
    const document = await this.events.findLatest(
      orderId === undefined ? { userId } : { userId, orderId },
    );
    return document === null ? null : fromRiskEventDocument(document);
  }
}
