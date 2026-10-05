/**
 * Use-case: siparise kurye atar (T13.1, B7).
 *
 * TEKRAR GUVENLIDIR: order, yazamadigi ya da cevabini alamadigi atamayi
 * yeniden ister (en az bir kez). Siparisi zaten tasiyan kurye varsa AYNISI
 * doner; ikinci bir kurye baglanmaz. Ayni siparis icin eszamanli iki istekte
 * kaybeden kazananin kuryesini okuyup doner. Kaybetmenin iki yolu vardir:
 *   - baska bos kurye vardi: benzersiz indeks (currentOrderId) yazimi CONFLICT
 *     ile durdurur;
 *   - kazanan son bos kuryeyi aldi: secim bos doner (null). Bu durumda da
 *     NOT_FOUND'dan once siparisin kuryesine bakilir; yoksa order "kurye yok"
 *     sanip 30 sn beklerdi (QA B1).
 *
 * HAVUZ (T13.2): kurye markete bagli degildir; siparisin marketinin konumu
 * kurye servisinin kopyasindan (markets) okunur ve cevresindeki bos kuryeler
 * arasindan secilir (domain/courier-pool.ts).
 *
 * ROTA (T13.2): atanan kuryenin rotasi (kurye -> market -> adres) uretilir ve
 * saklanir; cevaptaki varis tahmini rotanindir. Tekrar istek saklanan rotayi
 * doner (assignment-route.ts).
 *
 * Bos kurye yoksa NOT_FOUND: beklenen durumdur, order siparisi PREPARING'de
 * tutar ve 30 sn sonra yeniden dener (roadmap saga tablosu). Market kopyada
 * yoksa da NOT_FOUND (reason market_unknown) ve WARN: order dongude kalmaz,
 * 30 sn'de bir dener; veri hatasi gunlukte gorunur.
 */

import { AppError, ERROR_CODES, isAppError } from '@getir/core';
import type { Clock, Logger } from '@getir/core';

import { ETA_NOT_COMPUTED_SECONDS } from '../config/constants.js';
import type { AssignmentStrategy } from '../domain/assignment-strategy.js';
import type { Courier, GeoPoint } from '../domain/courier.js';
import type { CourierRepository } from '../domain/courier-repository.js';
import type { MarketLocator } from '../domain/market-locator.js';
import type { Route } from '../domain/route.js';
import type { AssignmentRoute } from './assignment-route.js';

export interface AssignCourierCommand {
  readonly orderId: string;
  readonly marketId: string;
  readonly deliveryLocation: GeoPoint;
}

export interface CourierAssignment {
  readonly courier: Courier;
  /** Ilk varis tahmini (rotadan); rota uretilemediyse ETA_NOT_COMPUTED_SECONDS. */
  readonly etaSeconds: number;
  /** true: kurye bu cagridan ONCE de bu siparisi tasiyordu (tekrar istek). */
  readonly reused: boolean;
}

export type AssignCourier = (
  command: AssignCourierCommand,
  logger: Logger,
) => Promise<CourierAssignment>;

export interface AssignCourierDeps {
  readonly repository: CourierRepository;
  readonly markets: MarketLocator;
  readonly strategy: AssignmentStrategy;
  /** Atamanin rotasi (T13.2): uretir ya da saklanani doner. */
  readonly route: AssignmentRoute;
  readonly clock: Clock;
}

/** Market kopyada yok: veri hatasi; order icin "kurye yok" gibi gorunur. */
export const MARKET_UNKNOWN = 'market_unknown';

const etaOf = (route: Route | null): number => route?.etaSeconds ?? ETA_NOT_COMPUTED_SECONDS;

export function createAssignCourier(deps: AssignCourierDeps): AssignCourier {
  /** Siparisi zaten tasiyan kurye: rotasi (saklanan ya da simdi uretilen) ile. */
  const reuse = async (
    courier: Courier,
    command: AssignCourierCommand,
    logger: Logger,
  ): Promise<CourierAssignment> => ({
    courier,
    etaSeconds: etaOf(await deps.route({ ...command, courier }, logger)),
    reused: true,
  });

  /** Eszamanli kazananin bu siparise bagladigi kurye; yoksa null. */
  const winnerOf = async (orderId: string, logger: Logger): Promise<Courier | null> => {
    const winner = await deps.repository.findByOrder(orderId);
    if (winner !== null) {
      logger.info({ orderId, courierId: winner.id }, 'eszamanli atamada siparisin kuryesi okundu');
    }
    return winner;
  };

  return async (command, logger) => {
    const existing = await deps.repository.findByOrder(command.orderId);
    if (existing !== null) {
      logger.info(
        { orderId: command.orderId, courierId: existing.id },
        'siparisin kuryesi zaten atanmis',
      );
      return reuse(existing, command, logger);
    }

    const marketLocation = await deps.markets.locate(command.marketId);
    if (marketLocation === null) {
      logger.warn(
        { orderId: command.orderId, marketId: command.marketId },
        'market konumu bilinmiyor',
      );
      throw AppError.notFound('Market konumu bilinmiyor', {
        details: { marketId: command.marketId, reason: MARKET_UNKNOWN },
      });
    }

    let claimed: Courier | null;
    try {
      claimed = await deps.strategy.claim({
        orderId: command.orderId,
        marketLocation,
        deliveryLocation: command.deliveryLocation,
        at: deps.clock.date(),
      });
    } catch (error: unknown) {
      if (!isAppError(error) || error.code !== ERROR_CODES.CONFLICT) {
        throw error;
      }
      // Ayni siparis icin eszamanli baska istek kazandi: onun kuryesi doner.
      const winner = await winnerOf(command.orderId, logger);
      if (winner === null) {
        // Kazanan bu arada birakildi: order yeniden ister, yeni kurye alir.
        throw error;
      }
      return reuse(winner, command, logger);
    }

    if (claimed === null) {
      // Son bos kuryeyi ayni siparis icin eszamanli baska istek almis olabilir.
      const winner = await winnerOf(command.orderId, logger);
      if (winner !== null) {
        return reuse(winner, command, logger);
      }
      throw AppError.notFound('Marketin cevresinde uygun kurye yok', {
        details: { marketId: command.marketId },
      });
    }

    const route = await deps.route({ ...command, courier: claimed, marketLocation }, logger);
    logger.info(
      {
        orderId: command.orderId,
        courierId: claimed.id,
        marketId: command.marketId,
        strategy: deps.strategy.name,
        etaSeconds: etaOf(route),
        distanceMeters: route?.distanceMeters,
      },
      'kurye atandi',
    );
    return { courier: claimed, etaSeconds: etaOf(route), reused: false };
  };
}
