/**
 * Uctan uca kapi testleri icin gercek inventory gRPC sunucusu + gercek istemci.
 * Secenek verilmezse bellekteki demo stogu (MOCK) ve sistem saati kullanilir.
 */

import { startTestGrpcServer } from '@getir/service-kit/testing';
import type { TestGrpcServer, UnaryCall } from '@getir/service-kit/testing';
import { afterAll, beforeAll } from 'vitest';

import type { BootstrapOptions } from '../../src/bootstrap.js';
import { buildInventoryService } from '../../src/bootstrap.js';

/**
 * Sunucuyu dosyanin omru boyunca ayakta tutar; tipli unary cagri fonksiyonu doner.
 * @param options Sunucu acilirken kurulur (depo, saat, gunluk).
 */
export function useInventoryGrpcServer(options: () => BootstrapOptions = () => ({})): UnaryCall {
  let server: TestGrpcServer | undefined;

  beforeAll(async () => {
    server = await startTestGrpcServer({
      serviceName: 'inventory-test',
      services: [buildInventoryService(options())],
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
