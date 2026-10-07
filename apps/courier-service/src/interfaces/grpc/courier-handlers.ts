/**
 * CourierService gRPC handler'lari: dogrula -> cagir -> cevir. Is kurali yok;
 * hata cevirisi ve gunlukleme service-kit'in ara katmanindadir.
 */

import type { Logger } from '@getir/core';
import type { courierV1 } from '@getir/proto';
import { unaryHandler } from '@getir/service-kit';
import type { UntypedServiceImplementation } from '@grpc/grpc-js';

import type { AssignCourier } from '../../application/assign-courier.js';
import type { GetCourier } from '../../application/get-courier.js';
import type { GetTracking } from '../../application/get-tracking.js';
import type { ReleaseCourier } from '../../application/release-courier.js';
import type { StartRoute } from '../../application/start-route.js';
import { toProtoCourier, toProtoRelease, toProtoStartedRoute, toProtoTracking } from './mappers.js';
import {
  assignCourierRequestSchema,
  getCourierRequestSchema,
  releaseCourierRequestSchema,
  getTrackingRequestSchema,
  startRouteRequestSchema,
} from './schemas.js';

export interface CourierHandlerDeps {
  readonly assignCourier: AssignCourier;
  readonly getCourier: GetCourier;
  readonly releaseCourier: ReleaseCourier;
  readonly startRoute: StartRoute;
  readonly getTracking: GetTracking;
  readonly logger?: Logger;
}

export function createCourierImplementation(
  deps: CourierHandlerDeps,
): UntypedServiceImplementation {
  const logger = deps.logger;

  return {
    assignCourier: unaryHandler({
      name: 'AssignCourier',
      schema: assignCourierRequestSchema,
      ...(logger === undefined ? {} : { logger }),
      handle: async (command, ctx): Promise<courierV1.AssignCourierResponse> => {
        const assignment = await deps.assignCourier(command, ctx.logger);
        return {
          courier: toProtoCourier(assignment.courier),
          etaSeconds: assignment.etaSeconds,
        };
      },
    }),

    getCourier: unaryHandler({
      name: 'GetCourier',
      schema: getCourierRequestSchema,
      ...(logger === undefined ? {} : { logger }),
      handle: async (courierId): Promise<courierV1.GetCourierResponse> => ({
        courier: toProtoCourier(await deps.getCourier(courierId)),
      }),
    }),

    releaseCourier: unaryHandler({
      name: 'ReleaseCourier',
      schema: releaseCourierRequestSchema,
      ...(logger === undefined ? {} : { logger }),
      handle: async (orderId, ctx): Promise<courierV1.ReleaseCourierResponse> =>
        toProtoRelease(await deps.releaseCourier(orderId, ctx.logger)),
    }),

    // Rota atamada uretilir (T13.2); burasi ayni rotayi doner. GPS T13.3'te.
    startRoute: unaryHandler({
      name: 'StartRoute',
      schema: startRouteRequestSchema,
      ...(logger === undefined ? {} : { logger }),
      handle: async (command, ctx): Promise<courierV1.StartRouteResponse> =>
        toProtoStartedRoute(await deps.startRoute(command, ctx.logger)),
    }),

    getTracking: unaryHandler({
      name: 'GetTracking',
      schema: getTrackingRequestSchema,
      ...(logger === undefined ? {} : { logger }),
      handle: async (orderId): Promise<courierV1.GetTrackingResponse> =>
        toProtoTracking(await deps.getTracking(orderId)),
    }),
  };
}
