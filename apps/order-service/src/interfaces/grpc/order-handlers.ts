/**
 * OrderService gRPC handler'lari.
 *
 * Handler dogrular, use-case'i cagirir, cevabi sozlesme bicimine cevirir.
 * Is kurali yok; hata cevirisi ve gunlukleme service-kit'in ara katmanindadir.
 */

import type { Logger } from '@getir/core';
import type { orderV1 } from '@getir/proto';
import { unaryHandler } from '@getir/service-kit';
import { Metadata, status as GrpcStatus } from '@grpc/grpc-js';
import type { handleUnaryCall, UntypedServiceImplementation } from '@grpc/grpc-js';

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

    // Sozlesmede tanimli ama HENUZ UYGULANMAMIS RPC'ler (bkz. catalog-service:
    // ayni gerekce - grpc-js eksik handler icin her acilista hata gunlugu yazar,
    // ve "bu uc henuz yok" bir is hatasi degil protokol gercegidir).
    getOrder: unimplemented('GetOrder', 'T4.5'),
    listMyOrders: unimplemented('ListMyOrders', 'T4.5'),
    cancelOrder: unimplemented('CancelOrder', 'T4.4'),
  };
}

/** Henuz yazilmamis RPC'nin durus noktasi; hangi gorevde gelecegini soyler. */
function unimplemented(rpc: string, task: string): handleUnaryCall<unknown, never> {
  return (_call, callback) => {
    const message = `${rpc} henuz uygulanmadi (${task})`;
    callback({
      name: 'ServiceError',
      message,
      code: GrpcStatus.UNIMPLEMENTED,
      details: message,
      metadata: new Metadata(),
    });
  };
}
