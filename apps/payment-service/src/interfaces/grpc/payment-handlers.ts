/**
 * PaymentService gRPC handler'lari.
 *
 * Handler dogrular, use-case'i cagirir, cevabi sozlesme bicimine cevirir. Is
 * kurali yok; hata cevirisi ve gunlukleme service-kit'in ara katmanindadir.
 *
 * Bugun yalnizca Charge var (T5.1). Confirm3Ds T5.2, GetPayment ve Refund
 * sonraki gorevlerde gelir; tanimlanmayan metotlara grpc-js UNIMPLEMENTED doner.
 */

import type { Logger } from '@getir/core';
import type { paymentV1 } from '@getir/proto';
import { unaryHandler } from '@getir/service-kit';
import type { UntypedServiceImplementation } from '@grpc/grpc-js';

import type { Charge } from '../../application/charge.js';
import { toProtoChargeResponse } from './mappers.js';
import { chargeRequestSchema } from './schemas.js';

export interface PaymentHandlerDeps {
  readonly charge: Charge;
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
  };
}
