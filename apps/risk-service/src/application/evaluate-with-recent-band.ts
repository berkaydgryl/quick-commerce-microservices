/**
 * Motoru yapiskan bantla sarar (#164): kurallar ve yakin bant okumasi PARALEL
 * kosar; bant yakin bandin altina inmez, skor degismez. Yukselirse rules[]'a
 * puansiz "recent-band" isabeti girer ve gunluge kaynak degerlendirmenin kimligi
 * ve zamani yazilir (IP/cihaz yok).
 *
 * Kayit (evaluate-and-record.ts) bu sarmalayicinin SONUCUNU yazar: yukseltilmis
 * bant ve isabet kayitta gorunur; yapiskanlik ise gecmisin SKORUNA baktigi icin
 * kendini uzatmaz (domain/recent-band.ts).
 */

import { raiseToRecentBand } from '../domain/recent-band.js';
import type { EvaluateRisk } from './evaluate-risk.js';
import type { ReadRecentBand } from './read-recent-band.js';

export interface EvaluateWithRecentBandDeps {
  readonly evaluateRisk: EvaluateRisk;
  readonly readRecentBand: ReadRecentBand;
}

export function createEvaluateWithRecentBand(deps: EvaluateWithRecentBandDeps): EvaluateRisk {
  return async (context, logger) => {
    const [evaluation, recent] = await Promise.all([
      deps.evaluateRisk(context, logger),
      deps.readRecentBand(context.userId, logger),
    ]);
    const sticky = raiseToRecentBand(evaluation, recent);
    if (recent !== null && sticky.band !== evaluation.band) {
      logger.info(
        {
          userId: context.userId,
          orderId: context.orderId,
          scoredBand: evaluation.band,
          band: sticky.band,
          sourceEventId: recent.sourceEventId,
          sourceEvaluatedAt: recent.sourceEvaluatedAt.toISOString(),
        },
        'risk bandi yakin degerlendirmeyle yukseltildi',
      );
    }
    return sticky;
  };
}
