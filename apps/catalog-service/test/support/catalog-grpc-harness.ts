/**
 * Uctan uca kapi testleri icin gercek catalog gRPC sunucusu + gercek istemci.
 *
 * Dis bagimlilik yok: katalog verisi bellekte (KLASIK demo kumesi,
 * classic-catalog.ts), sunucu isletim
 * sisteminin verdigi bos portta (@getir/service-kit/testing, D5). Cagiran spec
 * dosyasinda beforeAll/afterAll kaydeder; her dosya kendi sunucusunu alir,
 * dosyalar paralel kosabilir.
 */

import { startTestGrpcServer } from '@getir/service-kit/testing';
import type { TestGrpcServer, UnaryCall } from '@getir/service-kit/testing';
import { afterAll, beforeAll } from 'vitest';

import { buildCatalogService } from '../../src/bootstrap.js';
import { createInMemoryReaders } from '../../src/infrastructure/memory/in-memory-catalog.js';
import { CLASSIC_SNAPSHOT } from './classic-catalog.js';

/** Sunucuyu dosyanin omru boyunca ayakta tutar; tipli unary cagri fonksiyonu doner. */
export function useCatalogGrpcServer(): UnaryCall {
  let server: TestGrpcServer | undefined;

  beforeAll(async () => {
    server = await startTestGrpcServer({
      serviceName: 'catalog-test',
      services: [buildCatalogService({ readers: createInMemoryReaders(CLASSIC_SNAPSHOT) })],
    });
  });

  afterAll(async () => {
    await server?.stop();
  });

  return (method, request, metadata) =>
    server === undefined
      ? Promise.reject(new Error('test sunucusu henuz baslamadi'))
      : server.call(method, request, metadata);
}
