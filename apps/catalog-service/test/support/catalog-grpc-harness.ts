/**
 * Uctan uca kapi testleri icin gercek catalog gRPC sunucusu + gercek istemci.
 *
 * Dis bagimlilik yok: katalog verisi bellekte (demo verisi), sunucu isletim
 * sisteminin verdigi bos portta. Cagiran spec dosyasinda beforeAll/afterAll
 * kaydeder; her dosya kendi sunucusunu alir, dosyalar paralel kosabilir.
 */

import { startGrpcServer } from '@getir/service-kit';
import type { GrpcServerHandle } from '@getir/service-kit';
import { Client, credentials, Metadata } from '@grpc/grpc-js';
import type { MethodDefinition, ServiceError } from '@grpc/grpc-js';
import { afterAll, beforeAll } from 'vitest';

import { buildCatalogService } from '../../src/bootstrap.js';

/** Isletim sistemi bos bir port secsin; testler paralel kosarken cakismaz. */
const EPHEMERAL_PORT = 0;

export interface CallResult<TResponse> {
  readonly error: ServiceError | undefined;
  readonly response: TResponse | undefined;
}

/** Sozlesmeden gelen serialize/deserialize ile tipli unary cagri. */
export type UnaryCall = <TRequest, TResponse>(
  method: MethodDefinition<TRequest, TResponse>,
  request: TRequest,
) => Promise<CallResult<TResponse>>;

/** Sunucuyu dosyanin omru boyunca ayakta tutar; tipli unary cagri fonksiyonu doner. */
export function useCatalogGrpcServer(): UnaryCall {
  let handle: GrpcServerHandle | undefined;
  let client: Client | undefined;

  beforeAll(async () => {
    handle = await startGrpcServer({
      serviceName: 'catalog-test',
      host: '127.0.0.1',
      port: EPHEMERAL_PORT,
      services: [buildCatalogService()],
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
