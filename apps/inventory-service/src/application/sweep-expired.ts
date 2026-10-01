/**
 * Use-case: suresi dolan rezervasyonlarin stogunu geri verir (T10.3; ADR-02,
 * ADR-18, roadmap "Supurucu"). Lider ornekteki supurucu isci her turda cagirir.
 *
 * Her market icin bitis ani gelmis siparisler (resv:index, en eskisi once,
 * market basina en cok `batchSize`) release.lua'nin sure dolumu kipiyle
 * birakilir: script bitis anini YENIDEN denetler (uzatilmis rezervasyona
 * dokunmaz) ve sahipligi ZREM ile alir; onay ya da iptal ayni anda gelse de
 * rezervasyon tek yoldan sonuclanir (B3, B4). Sonra defter (expire, delta 0)
 * yazilir ve iz silinir.
 *
 * Defter yazilamazsa (Mongo erisilemez) sayaclar ZATEN donmustur; siparis
 * bekleyenlere alinir ve sonraki turlarda izden tamamlanir. Surec yeniden
 * baslarsa bekleyen liste kaybolur: o sure dolumunun defter kaydi eksik kalir
 * (delta 0, eldeki adet hesabini bozmaz); ayni siparise gelen Release izi bulup
 * tamamlar. Tek siparisin hatasi turu durdurmaz.
 *
 * Marketler stok kaynagindan okunur ve `marketRefreshMs`'te bir tazelenir.
 */

import type { Clock, Logger } from '@getir/core';

import type { ReservationLine, ReservationStore } from '../domain/reservation.js';
import { expireEntries } from '../domain/stock-ledger.js';
import type { StockLedger } from '../domain/stock-ledger.js';
import type { StockMarketSource } from '../domain/stock.js';

export interface SweepExpiredDeps {
  readonly markets: StockMarketSource;
  readonly reservations: Pick<ReservationStore, 'listDue' | 'expire' | 'forgetSettled'>;
  readonly ledger: Pick<StockLedger, 'record'>;
  readonly clock: Clock;
  readonly logger: Logger;
  /** Market basina tur basina en cok kac siparis (kalani sonraki tura). */
  readonly batchSize: number;
  /** Market listesinin tazelenme araligi (ms). */
  readonly marketRefreshMs: number;
}

export interface SweepResult {
  /** Bu turda stogu geri verilen rezervasyon. */
  readonly expired: number;
  /** Defteri yarida kalmis olup bu turda tamamlanan. */
  readonly completed: number;
  /** Defteri hala yazilamamis, sonraki turu bekleyen. */
  readonly pending: number;
}

export type SweepExpired = () => Promise<SweepResult>;

type OrderResult = 'expired' | 'completed' | 'skipped';

export function createSweepExpired(deps: SweepExpiredDeps): SweepExpired {
  const pending = new Map<string, { readonly marketId: string; readonly orderId: string }>();
  let markets: readonly string[] = [];
  let marketsLoadedAt = Number.NEGATIVE_INFINITY;

  const marketsAt = async (nowMs: number): Promise<readonly string[]> => {
    if (nowMs - marketsLoadedAt >= deps.marketRefreshMs) {
      markets = await deps.markets.marketIds();
      marketsLoadedAt = nowMs;
    }
    return markets;
  };

  /** Defter, sonra iz silme. Dusmeye (Mongo) karsi siparis bekleyenlere alinir. */
  const settle = async (
    marketId: string,
    orderId: string,
    lines: readonly ReservationLine[],
    at: Date,
  ): Promise<boolean> => {
    try {
      await deps.ledger.record(expireEntries({ marketId, orderId, lines, at }));
      await deps.reservations.forgetSettled(marketId, orderId);
      pending.delete(keyOf(marketId, orderId));
      return true;
    } catch (error: unknown) {
      pending.set(keyOf(marketId, orderId), { marketId, orderId });
      deps.logger.warn(
        { err: error, marketId, orderId },
        'sure dolumu: defter yazilamadi; sonraki turda tamamlanacak',
      );
      return false;
    }
  };

  const expireOne = async (
    marketId: string,
    orderId: string,
    nowMs: number,
  ): Promise<OrderResult> => {
    const outcome = await deps.reservations.expire({ orderId, marketId, nowMs });
    switch (outcome.status) {
      case 'expired':
        if (outcome.skippedCounters > 0) {
          deps.logger.warn(
            { marketId, orderId, skipped: outcome.skippedCounters },
            'sure dolumu: sayaci olmayan kalem geri eklenmedi',
          );
        }
        await settle(marketId, orderId, outcome.lines, new Date(nowMs));
        return 'expired';
      case 'settled':
        // Sure dolumunun defteri yarida kalmis: izden tamamlanir. Baska yolun
        // (onay, iptal) izi o yolun isidir; dokunulmaz.
        if (outcome.settlement === 'expired') {
          const done = await settle(marketId, orderId, outcome.lines, new Date(outcome.settledAt));
          return done ? 'completed' : 'skipped';
        }
        pending.delete(keyOf(marketId, orderId));
        return 'skipped';
      case 'orphaned':
        deps.logger.warn(
          { marketId, orderId },
          'sure dolumu: indeksteki rezervasyonun kaydi yok; stok geri verilemedi',
        );
        pending.delete(keyOf(marketId, orderId));
        return 'skipped';
      case 'absent':
      case 'not-due':
        pending.delete(keyOf(marketId, orderId));
        return 'skipped';
    }
  };

  /** Tek siparisin hatasi (orn. bozuk sayac) turu durdurmaz. */
  const attempt = async (marketId: string, orderId: string, nowMs: number) => {
    try {
      return await expireOne(marketId, orderId, nowMs);
    } catch (error: unknown) {
      deps.logger.error({ err: error, marketId, orderId }, 'sure dolumu basarisiz');
      return 'skipped';
    }
  };

  return async () => {
    const nowMs = deps.clock.now();
    let expired = 0;
    let completed = 0;
    const count = (result: OrderResult) => {
      if (result === 'expired') {
        expired += 1;
      } else if (result === 'completed') {
        completed += 1;
      }
    };

    for (const { marketId, orderId } of [...pending.values()]) {
      count(await attempt(marketId, orderId, nowMs));
    }
    for (const marketId of await marketsAt(nowMs)) {
      for (const orderId of await deps.reservations.listDue(marketId, nowMs, deps.batchSize)) {
        count(await attempt(marketId, orderId, nowMs));
      }
    }
    return { expired, completed, pending: pending.size };
  };
}

function keyOf(marketId: string, orderId: string): string {
  return `${marketId}/${orderId}`;
}
