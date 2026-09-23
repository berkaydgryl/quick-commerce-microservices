/**
 * OrderService gRPC handler'lari.
 *
 * Handler dogrular, use-case'i cagirir, cevabi sozlesme bicimine cevirir.
 * Is kurali yok; hata cevirisi ve gunlukleme service-kit'in ara katmanindadir.
 */

import type { Logger } from '@getir/core';
import type { orderV1 } from '@getir/proto';
import { unaryHandler } from '@getir/service-kit';
import type { UntypedServiceImplementation } from '@grpc/grpc-js';

import type { CancelOrder } from '../../application/cancel-order.js';
import type { CreateDraftOrder } from '../../application/create-draft-order.js';
import type { CreateOrder } from '../../application/create-order.js';
import type { GetOrder } from '../../application/get-order.js';
import type { ListMyOrders } from '../../application/list-my-orders.js';
import { toProtoOrder, toProtoOrderStatus } from './mappers.js';
import { encodePageToken } from './page-token.js';
import {
  cancelOrderRequestSchema,
  createDraftOrderRequestSchema,
  createOrderRequestSchema,
  getOrderRequestSchema,
  listMyOrdersRequestSchema,
} from './schemas.js';

/** Toplam sayim yapilmaz (pahali); sozlesme: 0 = "sayilmadi", "sonuc yok" degil. */
const TOTAL_SIZE_NOT_COUNTED = 0;

export interface OrderHandlerDeps {
  readonly createDraftOrder: CreateDraftOrder;
  readonly createOrder: CreateOrder;
  readonly getOrder: GetOrder;
  readonly listMyOrders: ListMyOrders;
  readonly cancelOrder: CancelOrder;
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
          marketId: input.marketId,
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

    getOrder: unaryHandler({
      name: 'GetOrder',
      schema: getOrderRequestSchema,
      ...(logger === undefined ? {} : { logger }),
      handle: async (input): Promise<orderV1.GetOrderResponse> => ({
        order: toProtoOrder(await deps.getOrder(input)),
      }),
    }),

    listMyOrders: unaryHandler({
      name: 'ListMyOrders',
      schema: listMyOrdersRequestSchema,
      ...(logger === undefined ? {} : { logger }),
      handle: async ({ userId, page }): Promise<orderV1.ListMyOrdersResponse> => {
        const result = await deps.listMyOrders({
          userId,
          pageSize: page.pageSize,
          after: page.pageToken,
        });
        const nextPageToken = result.next === undefined ? '' : encodePageToken(result.next);
        return {
          orders: result.orders.map(toProtoOrder),
          page: { nextPageToken, totalSize: TOTAL_SIZE_NOT_COUNTED },
        };
      },
    }),

    cancelOrder: unaryHandler({
      name: 'CancelOrder',
      schema: cancelOrderRequestSchema,
      ...(logger === undefined ? {} : { logger }),
      handle: async (input): Promise<orderV1.CancelOrderResponse> => {
        const order = await deps.cancelOrder(input);
        return { status: toProtoOrderStatus(order.status) };
      },
    }),
  };
}
