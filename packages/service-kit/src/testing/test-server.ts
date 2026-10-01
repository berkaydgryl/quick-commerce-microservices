/**
 * Test gRPC sunucusu (D5): servisleri isletim sisteminin sectigi bos portta
 * acar ve ona bagli bir istemci verir. Once her serviste ayri kopyasi vardi.
 *
 * vitest'e bagli DEGILDIR (service-kit'in bagimliligi olmasin): beforeAll /
 * afterAll kancalarini cagiran test dosyasi kurar.
 */

import { Client, credentials } from '@grpc/grpc-js';

import { startGrpcServer } from '../grpc/server.js';
import type { GrpcServerHandle, GrpcServerOptions } from '../grpc/types.js';
import { unaryCall } from './grpc-call.js';
import type { UnaryCall } from './grpc-call.js';

/** Yalnizca yerel arayuz: testler disari acilmaz. */
const TEST_HOST = '127.0.0.1';
/** Isletim sistemi bos bir port secsin; paralel kosan dosyalar cakismaz. */
const EPHEMERAL_PORT = 0;

export interface TestGrpcServerOptions extends Pick<
  GrpcServerOptions,
  | 'services'
  | 'logger'
  | 'shutdownTimeoutMs'
  | 'onShutdown'
  | 'shutdownHookTimeoutMs'
  | 'otlpEndpoint'
> {
  /** Gunlukteki kisa ad; verilmezse "test". */
  readonly serviceName?: string;
}

export interface TestGrpcServer {
  readonly handle: GrpcServerHandle;
  readonly client: Client;
  /** Bu sunucuya tipli unary cagri. */
  readonly call: UnaryCall;
  /** Once istemci, sonra sunucu kapanir (devam eden cagrilar bitsin). */
  stop(reason?: string): Promise<void>;
}

export async function startTestGrpcServer(options: TestGrpcServerOptions): Promise<TestGrpcServer> {
  const handle = await startGrpcServer({
    serviceName: options.serviceName ?? 'test',
    host: TEST_HOST,
    port: EPHEMERAL_PORT,
    services: options.services,
    ...(options.logger === undefined ? {} : { logger: options.logger }),
    ...(options.shutdownTimeoutMs === undefined
      ? {}
      : { shutdownTimeoutMs: options.shutdownTimeoutMs }),
    ...(options.onShutdown === undefined ? {} : { onShutdown: options.onShutdown }),
    ...(options.shutdownHookTimeoutMs === undefined
      ? {}
      : { shutdownHookTimeoutMs: options.shutdownHookTimeoutMs }),
    ...(options.otlpEndpoint === undefined ? {} : { otlpEndpoint: options.otlpEndpoint }),
  });
  const client = new Client(`${TEST_HOST}:${handle.port}`, credentials.createInsecure());
  return {
    handle,
    client,
    call: (method, request, metadata) => unaryCall(client, method, request, metadata),
    stop: async (reason = 'test bitti') => {
      client.close();
      await handle.shutdown(reason);
    },
  };
}
