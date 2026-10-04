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
 * Bos kurye yoksa NOT_FOUND: beklenen durumdur, order siparisi PREPARING'de
 * tutar ve 30 sn sonra yeniden dener (roadmap saga tablosu).
 */

import { AppError, ERROR_CODES, isAppError } from '@getir/core';
import type { Clock, Logger } from '@getir/core';

import { ETA_NOT_COMPUTED_SECONDS } from '../config/constants.js';
import type { AssignmentStrategy } from '../domain/assignment-strategy.js';
import type { Courier, GeoPoint } from '../domain/courier.js';
import type { CourierRepository } from '../domain/courier-repository.js';

export interface AssignCourierCommand {
  readonly orderId: string;
  readonly marketId: string;
  readonly deliveryLocation: GeoPoint;
}

export interface CourierAssignment {
  readonly courier: Courier;
  /** Ilk varis tahmini; rota gelene kadar (T13.2) ETA_NOT_COMPUTED_SECONDS. */
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
  readonly strategy: AssignmentStrategy;
  readonly clock: Clock;
}

export function createAssignCourier(deps: AssignCourierDeps): AssignCourier {
  const reuse = (courier: Courier): CourierAssignment => ({
    courier,
    etaSeconds: ETA_NOT_COMPUTED_SECONDS,
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
      return reuse(existing);
    }

    let claimed: Courier | null;
    try {
      claimed = await deps.strategy.claim({ ...command, at: deps.clock.date() });
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
      return reuse(winner);
    }

    if (claimed === null) {
      // Son bos kuryeyi ayni siparis icin eszamanli baska istek almis olabilir.
      const winner = await winnerOf(command.orderId, logger);
      if (winner !== null) {
        return reuse(winner);
      }
      throw AppError.notFound('Markette uygun kurye yok', {
        details: { marketId: command.marketId },
      });
    }

    logger.info(
      {
        orderId: command.orderId,
        courierId: claimed.id,
        marketId: claimed.marketId,
        strategy: deps.strategy.name,
      },
      'kurye atandi',
    );
    return { courier: claimed, etaSeconds: ETA_NOT_COMPUTED_SECONDS, reused: false };
  };
}
