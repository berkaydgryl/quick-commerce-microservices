/**
 * risk_events deposu portu. MOCK'ta bellek, aksi halde Mongo; ikisi ayni
 * sozlesme testinden gecer.
 */

import type { RiskEvent } from './risk-event.js';

export interface LatestEventQuery {
  readonly userId: string;
  /** Verilirse o siparisin son degerlendirmesi, verilmezse kullanicinin son degerlendirmesi. */
  readonly orderId?: string;
}

export interface RiskEventRepository {
  insert(event: RiskEvent): Promise<void>;
  /** En yeni kayit (evaluatedAt azalan); yoksa null. */
  findLatest(query: LatestEventQuery): Promise<RiskEvent | null>;
}
