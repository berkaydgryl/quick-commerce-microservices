/**
 * Yakin bandi okur (#164): kullanicinin son RECENT_BAND_WINDOW_MS icindeki
 * degerlendirmelerinin skordan gelen en yuksek bandi.
 *
 * FAIL-OPEN (kayit yolunun sure siniriyla ayni ilke, #167): okuma
 * RECENT_BAND_READ_TIMEOUT_MS'i asar ya da hata verirse yapiskanlik o
 * degerlendirmede UYGULANMAZ, WARN yazilir; karar yine doner. Risk siparisin
 * kritik yolundadir. Gunlukte yalnizca kullanici kimligi ve hata; IP/cihaz yok.
 */

import type { Clock, Logger } from '@getir/core';

import { recentBandOf } from '../domain/recent-band.js';
import type { RecentBand } from '../domain/recent-band.js';
import type { RecentRiskEvents } from '../domain/risk-event-repository.js';
import { withTimeout } from './with-timeout.js';

export interface ReadRecentBandDeps {
  readonly events: RecentRiskEvents;
  readonly clock: Clock;
  readonly windowMs: number;
  readonly readTimeoutMs: number;
}

/** Hic firlatmaz: okunamazsa null (yapiskanlik yok). */
export type ReadRecentBand = (userId: string, logger: Logger) => Promise<RecentBand | null>;

export function createReadRecentBand(deps: ReadRecentBandDeps): ReadRecentBand {
  return async (userId, logger) => {
    const since = new Date(deps.clock.now() - deps.windowMs);
    try {
      const highest = await withTimeout(
        // Surucuye de ayni sinir: beklemeyi birakmak yetmez, islem baglantiyi tutmasin.
        deps.events.findHighestRecent({ userId, since, timeoutMs: deps.readTimeoutMs }),
        deps.readTimeoutMs,
        'yakin bant okumasi',
      );
      return recentBandOf(highest);
    } catch (error) {
      logger.warn({ userId, err: error }, 'yakin bant okunamadi, yapiskanlik uygulanmadi');
      return null;
    }
  };
}
