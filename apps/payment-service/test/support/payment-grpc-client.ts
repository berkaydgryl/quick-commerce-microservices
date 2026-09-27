/**
 * Gercek payment gRPC sunucusu + gercek istemci: uctan uca testlerin ortak
 * duzenegi (D9; onceden uc dosyada ayri kopyasi vardi).
 */

import { startGrpcServer } from '@getir/service-kit';
import type { GrpcServerHandle } from '@getir/service-kit';
import { Client, credentials, Metadata } from '@grpc/grpc-js';
import type { MethodDefinition, ServiceError } from '@grpc/grpc-js';

import { buildPaymentService } from '../../src/bootstrap.js';
import type { BootstrapOptions } from '../../src/bootstrap.js';

/** Isletim sistemi bos bir port secsin; testler paralel kosarken cakismaz. */
const EPHEMERAL_PORT = 0;

export interface CallResult<TResponse> {
  readonly error: ServiceError | undefined;
  readonly response: TResponse | undefined;
}

/**
 * Sozlesmeden gelen serialize/deserialize ile tipli unary cagri. Hata
 * firlatilmaz, sonuca konur: testler hata kodunu ve ayrintisini okur.
 * Metadata verilmezse bos gider (x-request-id'yi sunucu uretir).
 */
export function unaryCall<TRequest, TResponse>(
  client: Client,
  method: MethodDefinition<TRequest, TResponse>,
  request: TRequest,
  metadata: Metadata = new Metadata(),
): Promise<CallResult<TResponse>> {
  return new Promise((resolve) => {
    client.makeUnaryRequest(
      method.path,
      method.requestSerialize,
      method.responseDeserialize,
      request,
      metadata,
      (error, response) => {
        resolve({ error: error ?? undefined, response: response ?? undefined });
      },
    );
  });
}

export interface RunningPaymentService {
  readonly handle: GrpcServerHandle;
  readonly client: Client;
  /** Once istemci, sonra sunucu (devam eden cagrilar bitsin). */
  stop(reason?: string): Promise<void>;
}

/** Servisi bos portta acar; bagimliliklar verilmezse bellek deposu ve mock saglayici. */
export async function startPaymentService(
  options: BootstrapOptions = {},
  serviceName = 'payment-test',
): Promise<RunningPaymentService> {
  const handle = await startGrpcServer({
    serviceName,
    host: '127.0.0.1',
    port: EPHEMERAL_PORT,
    services: [buildPaymentService(options)],
  });
  const client = new Client(`127.0.0.1:${handle.port}`, credentials.createInsecure());
  return {
    handle,
    client,
    stop: async (reason = 'test bitti') => {
      client.close();
      await handle.shutdown(reason);
    },
  };
}
