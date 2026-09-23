/**
 * PaymentService gRPC handler'lari.
 *
 * Handler dogrular, use-case'i cagirir, cevabi sozlesme bicimine cevirir. Is
 * kurali yok; hata cevirisi ve gunlukleme service-kit'in ara katmanindadir.
 *
 * Charge (T5.1) ve Confirm3Ds (T5.2). GetPayment ve Refund sonraki gorevlerde
 * gelir; tanimlanmayan metotlara grpc-js UNIMPLEMENTED doner.
 */

import type { Logger } from '@getir/core';
import type { paymentV1 } from '@getir/proto';
import { unaryHandler } from '@getir/service-kit';
import type { UntypedServiceImplementation } from '@grpc/grpc-js';

import type { Charge } from '../../application/charge.js';
import type { Confirm3Ds } from '../../application/confirm-3ds.js';
import { toProtoChargeResponse, toProtoPayment } from './mappers.js';
import { chargeRequestSchema, confirm3DsRequestSchema } from './schemas.js';

export interface PaymentHandlerDeps {
  readonly charge: Charge;
  readonly confirm3Ds: Confirm3Ds;
  readonly logger?: Logger;
}

export function createPaymentImplementation(
  deps: PaymentHandlerDeps,
): UntypedServiceImplementation {
  const logger = deps.logger;

  return {
    charge: unaryHandler({
      name: 'Charge',
      schema: chargeRequestSchema,
      ...(logger === undefined ? {} : { logger }),
      handle: async (input): Promise<paymentV1.ChargeResponse> =>
        toProtoChargeResponse(await deps.charge(input)),
    }),

    confirm3Ds: unaryHandler({
      name: 'Confirm3Ds',
      schema: confirm3DsRequestSchema,
      ...(logger === undefined ? {} : { logger }),
      handle: async (input): Promise<paymentV1.Confirm3DsResponse> => ({
        payment: toProtoPayment(await deps.confirm3Ds(input)),
      }),
    }),
  };
}
