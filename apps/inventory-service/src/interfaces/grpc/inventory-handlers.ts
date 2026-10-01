/**
 * InventoryService gRPC handler'lari.
 *
 * Handler'in isi UCTUR: dogrula (sema), use-case'i cagir, cevabi sozlesme
 * bicimine cevir. Hata cevirisi ve gunlukleme @getir/service-kit'in
 * unaryHandler ara katmanindadir.
 */

import type { Logger } from '@getir/core';
import type { inventoryV1 } from '@getir/proto';
import { unaryHandler, unimplemented } from '@getir/service-kit';
import type { UntypedServiceImplementation } from '@grpc/grpc-js';

import type { CheckAvailability } from '../../application/check-availability.js';
import type { CommitReservation } from '../../application/commit-reservation.js';
import type { ReleaseReservation } from '../../application/release-reservation.js';
import type { ReserveStock } from '../../application/reserve-stock.js';
import {
  toCheckAvailabilityResponse,
  toCommitResponse,
  toReleaseResponse,
  toReserveResponse,
} from './mappers.js';
import {
  checkAvailabilityRequestSchema,
  commitRequestSchema,
  releaseRequestSchema,
  reserveRequestSchema,
} from './schemas.js';

export interface InventoryHandlerDeps {
  readonly checkAvailability: CheckAvailability;
  readonly reserveStock: ReserveStock;
  readonly releaseReservation: ReleaseReservation;
  readonly commitReservation: CommitReservation;
  readonly logger?: Logger;
}

export function createInventoryImplementation(
  deps: InventoryHandlerDeps,
): UntypedServiceImplementation {
  const logger = deps.logger === undefined ? {} : { logger: deps.logger };

  return {
    checkAvailability: unaryHandler({
      name: 'CheckAvailability',
      schema: checkAvailabilityRequestSchema,
      ...logger,
      handle: async (input): Promise<inventoryV1.CheckAvailabilityResponse> =>
        toCheckAvailabilityResponse(await deps.checkAvailability(input)),
    }),

    reserve: unaryHandler({
      name: 'Reserve',
      schema: reserveRequestSchema,
      ...logger,
      handle: async (input): Promise<inventoryV1.ReserveResponse> =>
        toReserveResponse(await deps.reserveStock(input)),
    }),

    release: unaryHandler({
      name: 'Release',
      schema: releaseRequestSchema,
      ...logger,
      handle: async (input): Promise<inventoryV1.ReleaseResponse> =>
        toReleaseResponse(await deps.releaseReservation(input)),
    }),

    commit: unaryHandler({
      name: 'Commit',
      schema: commitRequestSchema,
      ...logger,
      handle: async (input): Promise<inventoryV1.CommitResponse> =>
        toCommitResponse(await deps.commitReservation(input)),
    }),

    // Sozlesmede tanimli ama HENUZ UYGULANMAMIS RPC'ler: NOT_IMPLEMENTED (501),
    // gerekce @getir/service-kit grpc/unimplemented.ts'te. Uzatma T11.3'te.
    extendReservation: unimplemented('ExtendReservation', 'T10', deps.logger),
    getReservation: unimplemented('GetReservation', 'T10', deps.logger),
  };
}
