/**
 * QA kara kutu duzenegi (T13.1): kurye servisini GERCEK gRPC sunucusu ve
 * istemcisiyle acar. Testler yalnizca tel uzerindeki sozlesmeyi gorur: proto
 * cevabi, gRPC durum kodu ve `x-app-error` yuku. Depo disaridan verilir
 * (MOCK'un bellek deposu ya da gercek Mongo); use-case'e dokunulmaz.
 */

import { GRPC_STATUS } from '@getir/core';
import type { Logger, MutableClock } from '@getir/core';
import { courierV1 } from '@getir/proto';
import { appErrorOf, startTestGrpcServer } from '@getir/service-kit/testing';
import type { CallResult, TestGrpcServer } from '@getir/service-kit/testing';

import { buildCourierService } from '../../src/bootstrap.js';
import type { CourierRepository } from '../../src/domain/courier-repository.js';

export const COURIER_SERVICE = courierV1.CourierServiceService;

/** Katalogun demo marketlerinin sayisi ve markete dusen kurye (T13.1: 21 x 3 = 63). */
export const DEMO_MARKET_COUNT = 21;
export const DEMO_COURIERS_PER_MARKET = 3;
export const DEMO_COURIER_COUNT = DEMO_MARKET_COUNT * DEMO_COURIERS_PER_MARKET;

export const QA_DELIVERY = { lat: 40.99, lng: 29.03 } as const;

export interface QaGeoPoint {
  readonly lat: number;
  readonly lng: number;
}

export interface QaCourierServer {
  readonly server: TestGrpcServer;
  assign(
    orderId: string,
    marketId: string,
    deliveryLocation?: QaGeoPoint,
  ): Promise<CallResult<courierV1.AssignCourierResponse>>;
  get(courierId: string): Promise<CallResult<courierV1.GetCourierResponse>>;
  release(orderId: string): Promise<CallResult<courierV1.ReleaseCourierResponse>>;
  stop(): Promise<void>;
}

export async function startQaCourierServer(options: {
  readonly repository: CourierRepository;
  readonly clock: MutableClock;
  readonly logger?: Logger;
  readonly name?: string;
}): Promise<QaCourierServer> {
  const server = await startTestGrpcServer({
    serviceName: options.name ?? 'courier-qa',
    services: [
      buildCourierService({
        couriers: options.repository,
        clock: options.clock,
        ...(options.logger === undefined ? {} : { logger: options.logger }),
      }),
    ],
    ...(options.logger === undefined ? {} : { logger: options.logger }),
  });
  return {
    server,
    assign: (orderId, marketId, deliveryLocation = QA_DELIVERY) =>
      server.call(
        COURIER_SERVICE.assignCourier,
        courierV1.AssignCourierRequest.fromPartial({ orderId, marketId, deliveryLocation }),
      ),
    get: (courierId) =>
      server.call(
        COURIER_SERVICE.getCourier,
        courierV1.GetCourierRequest.fromPartial({ courierId }),
      ),
    release: (orderId) =>
      server.call(
        COURIER_SERVICE.releaseCourier,
        courierV1.ReleaseCourierRequest.fromPartial({ orderId }),
      ),
    stop: () => server.stop(),
  };
}

/**
 * Bir cagrinin tel uzerindeki sonucu, karsilastirmaya uygun tek bicimde:
 * basariliysa atanan kurye, degilse gRPC kodu ve is kodu.
 */
export type QaOutcome =
  | { readonly kind: 'atandi'; readonly courierId: string; readonly orderId: string }
  | { readonly kind: 'hata'; readonly grpc: number; readonly code: string | undefined };

export function outcomeOf(result: CallResult<courierV1.AssignCourierResponse>): QaOutcome {
  if (result.error !== undefined) {
    return { kind: 'hata', grpc: result.error.code, code: appErrorOf(result.error)?.code };
  }
  return {
    kind: 'atandi',
    courierId: result.response?.courier?.id ?? '',
    orderId: result.response?.courier?.currentOrderId ?? '',
  };
}

export const isNotFound = (outcome: QaOutcome): boolean =>
  outcome.kind === 'hata' && outcome.grpc === GRPC_STATUS.NOT_FOUND;
