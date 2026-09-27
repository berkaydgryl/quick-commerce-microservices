/**
 * PaymentService gRPC handler'lari.
 *
 * Handler dogrular, use-case'i cagirir, cevabi sozlesme bicimine cevirir. Is
 * kurali yok; hata cevirisi ve gunlukleme service-kit'in ara katmanindadir.
 *
 * Charge (T5.1), Confirm3Ds (T5.2) ve Refund (T7.1, siparis saga'sinin
 * telafisi). GetPayment'i henuz cagiran yok; tanimlanmayan metoda grpc-js
 * UNIMPLEMENTED doner.
 */

import type { Logger } from '@getir/core';
import type { paymentV1 } from '@getir/proto';
import { unaryHandler } from '@getir/service-kit';
import type { UntypedServiceImplementation } from '@grpc/grpc-js';

import type { Charge } from '../../application/charge.js';
import type { Confirm3Ds } from '../../application/confirm-3ds.js';
import type { Refund } from '../../application/refund.js';
import { toProtoChargeResponse, toProtoPayment } from './mappers.js';
import { chargeRequestSchema, confirm3DsRequestSchema, refundRequestSchema } from './schemas.js';

export interface PaymentHandlerDeps {
  readonly charge: Charge;
  readonly confirm3Ds: Confirm3Ds;
  readonly refund: Refund;
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
      handle: async (input, ctx): Promise<paymentV1.ChargeResponse> =>
        toProtoChargeResponse(await deps.charge(input, ctx.logger)),
    }),

    confirm3Ds: unaryHandler({
      name: 'Confirm3Ds',
      schema: confirm3DsRequestSchema,
      ...(logger === undefined ? {} : { logger }),
      handle: async (input): Promise<paymentV1.Confirm3DsResponse> => ({
        payment: toProtoPayment(await deps.confirm3Ds(input)),
      }),
    }),

    refund: unaryHandler({
      name: 'Refund',
      schema: refundRequestSchema,
      ...(logger === undefined ? {} : { logger }),
      handle: async (input): Promise<paymentV1.RefundResponse> => {
        const { payment, alreadyRefunded } = await deps.refund({
          orderId: input.orderId,
          reason: input.reason,
        });
        return { payment: toProtoPayment(payment), alreadyRefunded };
      },
    }),
  };
}
