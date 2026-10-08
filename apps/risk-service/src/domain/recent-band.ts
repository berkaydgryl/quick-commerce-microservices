/**
 * Yapiskan bant (#164, saf): yeni degerlendirmenin bandi, kullanicinin yakin
 * gecmisteki (RECENT_BAND_WINDOW_MS) en yuksek bandinin ALTINA inmez. "MEDIUM'dan
 * sonra iptal et, hemen tekrar dene, LOW gel, 3DS'siz ode" yolu kapanir.
 *
 * Gecmis kaydin bandi KAYDEDILEN banttan degil SKORUNDAN (ve vetosundan) turetilir:
 * yukseltilmis bant kendini yeniden yukseltmez, yapiskanlik pencereyle sinirli
 * kalir (10 dk arayla uc sipariste bant ucuncude duser). Skor degismez.
 */

import { RISK_BANDS } from '@getir/core';
import type { RiskBand } from '@getir/core';

import type { RiskEvent } from './risk-event.js';
import type { RuleResult } from './rule.js';
import { bandOf } from './score.js';
import type { RiskAssessment } from './score.js';

/** rules[]'taki aciklama isabetinin kimligi (puan ve veto tasimaz). */
export const RECENT_BAND_RULE_ID = 'recent-band';

const BAND_RANK: Readonly<Record<RiskBand, number>> = {
  [RISK_BANDS.LOW]: 0,
  [RISK_BANDS.MEDIUM]: 1,
  [RISK_BANDS.HIGH]: 2,
  [RISK_BANDS.CRITICAL]: 3,
};

/** Yapiskanligi veren gecmis degerlendirme. */
export interface RecentBand {
  readonly band: RiskBand;
  readonly sourceEventId: string;
  readonly sourceEvaluatedAt: Date;
}

/** Kaydin skordan (ve vetodan) gelen bandi; kaydedilen (yukseltilmis olabilir) bant DEGIL. */
export function scoredBandOf(event: Pick<RiskEvent, 'score' | 'vetoedByRuleId'>): RiskBand {
  return bandOf(event.score, event.vetoedByRuleId !== undefined);
}

/** Penceredeki en yuksek kayittan yakin bant (kayit yoksa null). */
export function recentBandOf(event: RiskEvent | null): RecentBand | null {
  return event === null
    ? null
    : { band: scoredBandOf(event), sourceEventId: event.id, sourceEvaluatedAt: event.evaluatedAt };
}

/**
 * Degerlendirmenin bandini yakin bantla yukseltir; dusurmez. Yukselirse rules[]'a
 * puansiz "recent-band" isabeti eklenir ("neden"in kaydi); skor ve veto ayni kalir.
 */
export function raiseToRecentBand<T extends RiskAssessment>(
  assessment: T,
  recent: RecentBand | null,
): T {
  if (recent === null || BAND_RANK[recent.band] <= BAND_RANK[assessment.band]) {
    return assessment;
  }
  const hit: RuleResult = {
    ruleId: RECENT_BAND_RULE_ID,
    hit: true,
    weight: 0,
    score: 0,
    // Kayit "neden"i kendi anlatir: kaynak degerlendirmenin kimligi (kisisel veri degil).
    reason: `penceredeki en yuksek degerlendirme ${recent.sourceEventId} ${recent.band} bandinda; bant yapisti`,
    veto: false,
  };
  return { ...assessment, band: recent.band, hits: [...assessment.hits, hit] };
}
