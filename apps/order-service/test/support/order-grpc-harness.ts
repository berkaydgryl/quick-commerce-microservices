/**
 * Uctan uca kapi testleri icin gercek order gRPC sunucusu + gercek istemci.
 *
 * Cagiran spec dosyasinda beforeAll/afterAll kaydeder: her dosya KENDI
 * sunucusunu ve dolayisiyla kendi bellek deposunu alir; dosyalar birbirinin
 * siparislerini gormez.
 */

import { orderV1 } from '@getir/proto';
import { startGrpcServer } from '@getir/service-kit';
import type { GrpcServerHandle } from '@getir/service-kit';
import { Client, credentials, Metadata } from '@grpc/grpc-js';
import type { MethodDefinition, ServiceError } from '@grpc/grpc-js';
import { afterAll, beforeAll } from 'vitest';

import { buildOrderService } from '../../src/bootstrap.js';
import { draftRequest } from './order-fixtures.js';

const EPHEMERAL_PORT = 0;

export interface CallResult<TResponse> {
  readonly error: ServiceError | undefined;
  readonly response: TResponse | undefined;
}

export type UnaryCall = <TRequest, TResponse>(
  method: MethodDefinition<TRequest, TResponse>,
  request: TRequest,
) => Promise<CallResult<TResponse>>;

/** Sunucuyu dosyanin omru boyunca ayakta tutar; tipli unary cagri fonksiyonu doner. */
export function useOrderGrpcServer(): UnaryCall {
  let handle: GrpcServerHandle | undefined;
  let client: Client | undefined;

  beforeAll(async () => {
    handle = await startGrpcServer({
      serviceName: 'order-test',
      host: '127.0.0.1',
      port: EPHEMERAL_PORT,
      services: [buildOrderService()],
    });
    client = new Client(`127.0.0.1:${handle.port}`, credentials.createInsecure());
  });

  afterAll(async () => {
    client?.close();
    await handle?.shutdown('test bitti');
  });

  return (method, request) =>
    new Promise((resolve, reject) => {
      if (client === undefined) {
        reject(new Error('test sunucusu henuz baslamadi'));
        return;
      }
      client.makeUnaryRequest(
        method.path,
        method.requestSerialize,
        method.responseDeserialize,
        request,
        new Metadata(),
        (error, response) => {
          resolve({ error: error ?? undefined, response: response ?? undefined });
        },
      );
    });
}

/** Yeni bir taslak acar ve kimligini doner (onkosul adimi; kendisi test edilmez). */
export async function newDraftId(
  call: UnaryCall,
  request: orderV1.CreateDraftOrderRequest = draftRequest,
): Promise<string> {
  const { response } = await call(orderV1.OrderServiceService.createDraftOrder, request);
  return response?.orderId ?? '';
}
