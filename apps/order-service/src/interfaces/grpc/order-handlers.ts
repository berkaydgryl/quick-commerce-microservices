/**
 * OrderService gRPC handler'lari.
 *
 * Handler dogrular, use-case'i cagirir, cevabi sozlesme bicimine cevirir.
 * Is kurali yok; hata cevirisi ve gunlukleme service-kit'in ara katmanindadir.
 */

import type { Logger } from '@getir/core';
import type { orderV1 } from '@getir/proto';
import { unaryHandler, unimplemented } from '@getir/service-kit';
import type { UntypedServiceImplementation } from '@grpc/grpc-js';

import type { CreateDraftOrder } from '../../application/create-draft-order.js';
import type { CreateOrder } from '../../application/create-order.js';
import { toProtoOrderStatus } from './mappers.js';
import { createDraftOrderRequestSchema, createOrderRequestSchema } from './schemas.js';

export interface OrderHandlerDeps {
  readonly createDraftOrder: CreateDraftOrder;
  readonly createOrder: CreateOrder;
  readonly logger?: Logger;
}

export function createOrderImplementation(deps: OrderHandlerDeps): UntypedServiceImplementation {
  const logger = deps.logger;

  return {
    createDraftOrder: unaryHandler({
      name: 'CreateDraftOrder',
      schema: createDraftOrderRequestSchema,
      ...(logger === undefined ? {} : { logger }),
      handle: async (input): Promise<orderV1.CreateDraftOrderResponse> => {
        const order = await deps.createDraftOrder({
          userId: input.userId,
          darkStoreId: input.darkStoreId,
          lines: input.lines,
          deliveryLocation: input.deliveryLocation,
          deliveryAddress: input.deliveryAddress,
        });

        // reservationExpiresAt BOS: stok henuz kilitlenmiyor (T11.2). Sozlesme
        // "yalnizca RESERVED/AWAITING_PAYMENT durumlarinda doludur" diyor;
        // DRAFT icin bos birakmak dogru davranis.
        return { orderId: order.id, status: toProtoOrderStatus(order.status) };
      },
    }),

    createOrder: unaryHandler({
      name: 'CreateOrder',
      schema: createOrderRequestSchema,
      ...(logger === undefined ? {} : { logger }),
      handle: async (input): Promise<orderV1.CreateOrderResponse> => {
        const order = await deps.createOrder({ orderId: input.orderId, userId: input.userId });

        // challengeId BOS: 3DS akisi T5.2 ve T7.1 ile gelecek. Sozlesme
        // "bos degilse 3DS bekleniyor demektir" diyor; bos birakmak
        // "beklenmiyor" anlamina gelir ve bugun dogru olan budur.
        return { orderId: order.id, status: toProtoOrderStatus(order.status), challengeId: '' };
      },
    }),

    // Sozlesmede tanimli ama HENUZ UYGULANMAMIS RPC'ler; gerekce
    // @getir/service-kit grpc/unimplemented.ts'te.
    getOrder: unimplemented('GetOrder', 'T4.5'),
    listMyOrders: unimplemented('ListMyOrders', 'T4.5'),
    cancelOrder: unimplemented('CancelOrder', 'T4.4'),
  };
}
