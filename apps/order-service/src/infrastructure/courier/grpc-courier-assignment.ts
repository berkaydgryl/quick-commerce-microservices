/**
 * CourierAssignment portunun gRPC uygulamasi: order -> courier (T13.1 PR 2).
 *
 * Tasima isi service-kit callUnary'dedir; burasi yalnizca domain <-> proto
 * cevirisini yapar. Iki cagri da tekrar guvenli (courier-svc: ayni siparise
 * ayni kurye; tasiyan yoksa released=false), D17 yeniden denemesi ikisinde de
 * acik. Markette bos kurye yoksa courier-svc NOT_FOUND doner: hata degil, null.
 */

import { AppError, ERROR_CODES, isAppError } from '@getir/core';
import { courierV1 } from '@getir/proto';
import { callUnary } from '@getir/service-kit';
import type { OutgoingCallOptions } from '@getir/service-kit';
import { credentials } from '@grpc/grpc-js';

import type {
  AssignedCourier,
  CourierAssignment,
  CourierAssignmentRequest,
} from '../../application/courier-assignment.js';
import type { RequestScope } from '../../application/request-scope.js';
import { IDEMPOTENT, outgoingOptions } from '../grpc-resilience.js';
import type { ClientResilience } from '../grpc-resilience.js';

export class GrpcCourierAssignment implements CourierAssignment {
  private readonly client: courierV1.CourierServiceClient;

  constructor(
    address: string,
    private readonly timeoutMs: number,
    private readonly resilience: ClientResilience = {},
  ) {
    this.client = new courierV1.CourierServiceClient(address, credentials.createInsecure());
  }

  async assign(
    request: CourierAssignmentRequest,
    scope: RequestScope,
  ): Promise<AssignedCourier | null> {
    let response: courierV1.AssignCourierResponse;
    try {
      response = await callUnary<courierV1.AssignCourierRequest, courierV1.AssignCourierResponse>(
        (message, metadata, options, callback) =>
          this.client.assignCourier(message, metadata, options, callback),
        {
          orderId: request.orderId,
          // ADR-15: courier-svc okumaz, market_id zorunlu.
          darkStoreId: '',
          marketId: request.marketId,
          deliveryLocation: {
            lat: request.deliveryLocation.lat,
            lng: request.deliveryLocation.lng,
          },
        },
        this.options(scope),
      );
    } catch (error: unknown) {
      if (isAppError(error) && error.code === ERROR_CODES.NOT_FOUND) {
        return null;
      }
      throw error;
    }
    const courierId = response.courier?.id ?? '';
    if (courierId === '') {
      throw AppError.internal('Kurye servisi kuryesiz atama cevabi dondu', {
        details: { orderId: request.orderId },
      });
    }
    return { courierId };
  }

  async release(orderId: string, scope: RequestScope): Promise<boolean> {
    const response = await callUnary<
      courierV1.ReleaseCourierRequest,
      courierV1.ReleaseCourierResponse
    >(
      (message, metadata, options, callback) =>
        this.client.releaseCourier(message, metadata, options, callback),
      { orderId },
      this.options(scope),
    );
    return response.released;
  }

  /** Kapanista cagrilir: acik HTTP/2 baglantisi process'i ayakta tutmasin. */
  close(): void {
    this.client.close();
  }

  /** Devre her cagrida; iki cagri da idempotent, yeniden deneme acik (D17). */
  private options(scope: RequestScope): OutgoingCallOptions {
    return outgoingOptions(scope, this.timeoutMs, this.resilience, IDEMPOTENT);
  }
}
