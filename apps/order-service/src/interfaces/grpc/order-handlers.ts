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
import type { ConfirmPayment } from '../../application/confirm-payment.js';
import type { CreateDraftOrder } from '../../application/create-draft-order.js';
import type { CreateOrder } from '../../application/create-order.js';
import type { GetOrder } from '../../application/get-order.js';
import type { ListMyOrders } from '../../application/list-my-orders.js';
import { toProtoOrder, toProtoOrderStatus } from './mappers.js';
import { encodePageToken } from './page-token.js';
import {
  cancelOrderRequestSchema,
  confirmPaymentRequestSchema,
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
  readonly confirmPayment: ConfirmPayment;
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
      handle: async (input, ctx): Promise<orderV1.CreateDraftOrderResponse> => {
        const order = await deps.createDraftOrder(
          {
            userId: input.userId,
            marketId: input.marketId,
            lines: input.lines,
            deliveryLocation: input.deliveryLocation,
            deliveryAddress: input.deliveryAddress,
            expectedTotalMinor: input.expectedTotal.amountMinor,
            couponCode: input.couponCode,
          },
          // catalog cagrisi bu requestId'yi AYNEN tasir (yeniden uretilmez).
          { requestId: ctx.requestId, logger: ctx.logger },
        );

        // Geri sayimin bitecegi an (T11.2): stok taslak acilirken kilitlendi.
        return {
          orderId: order.id,
          status: toProtoOrderStatus(order.status),
          ...(order.reservation === undefined
            ? {}
            : { reservationExpiresAt: order.reservation.expiresAt }),
        };
      },
    }),

    createOrder: unaryHandler({
      name: 'CreateOrder',
      schema: createOrderRequestSchema,
      ...(logger === undefined ? {} : { logger }),
      handle: async (input, ctx): Promise<orderV1.CreateOrderResponse> => {
        const { order, challengeId } = await deps.createOrder(
          {
            orderId: input.orderId,
            userId: input.userId,
            method: input.paymentMethod,
            ...(input.cardToken === undefined ? {} : { cardToken: input.cardToken }),
            signals: input.signals,
          },
          // risk ve payment cagrilari bu requestId'yi AYNEN tasir.
          { requestId: ctx.requestId, logger: ctx.logger },
        );

        // Sozlesme: challengeId bos DEGILSE 3DS bekleniyor demektir.
        return {
          orderId: order.id,
          status: toProtoOrderStatus(order.status),
          challengeId: challengeId ?? '',
        };
      },
    }),

    confirmPayment: unaryHandler({
      name: 'ConfirmPayment',
      schema: confirmPaymentRequestSchema,
      ...(logger === undefined ? {} : { logger }),
      handle: async (input, ctx): Promise<orderV1.ConfirmPaymentResponse> => {
        const order = await deps.confirmPayment(
          {
            orderId: input.orderId,
            userId: input.userId,
            challengeId: input.challengeId,
            code: input.code,
          },
          { requestId: ctx.requestId, logger: ctx.logger },
        );
        return { orderId: order.id, status: toProtoOrderStatus(order.status) };
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
      handle: async (input, ctx): Promise<orderV1.CancelOrderResponse> => {
        const order = await deps.cancelOrder(input, {
          requestId: ctx.requestId,
          logger: ctx.logger,
        });
        return { status: toProtoOrderStatus(order.status) };
      },
    }),
  };
}
