/**
 * Uctan uca kapi testleri icin gercek inventory gRPC sunucusu + gercek istemci.
 * Sayaclar verilmezse bellekteki demo stogu (MOCK) kullanilir.
 */

import { startTestGrpcServer } from '@getir/service-kit/testing';
import type { TestGrpcServer, UnaryCall } from '@getir/service-kit/testing';
import { afterAll, beforeAll } from 'vitest';

import { buildInventoryService } from '../../src/bootstrap.js';
import type { StockCounterReader } from '../../src/domain/stock.js';

/** Sunucuyu dosyanin omru boyunca ayakta tutar; tipli unary cagri fonksiyonu doner. */
export function useInventoryGrpcServer(counters?: () => StockCounterReader): UnaryCall {
  let server: TestGrpcServer | undefined;

  beforeAll(async () => {
    server = await startTestGrpcServer({
      serviceName: 'inventory-test',
      services: [buildInventoryService(counters === undefined ? {} : { counters: counters() })],
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
