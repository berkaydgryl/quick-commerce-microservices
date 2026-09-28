/**
 * Uctan uca kapi testleri icin gercek order gRPC sunucusu + gercek istemci
 * (@getir/service-kit/testing, D5).
 *
 * Cagiran spec dosyasinda beforeAll/afterAll kaydeder: her dosya KENDI
 * sunucusunu ve dolayisiyla kendi bellek deposunu alir; dosyalar birbirinin
 * siparislerini gormez.
 */

import { orderV1 } from '@getir/proto';
import { startTestGrpcServer } from '@getir/service-kit/testing';
import type { TestGrpcServer, UnaryCall } from '@getir/service-kit/testing';
import { afterAll, beforeAll } from 'vitest';

import type { CatalogPricing } from '../../src/application/catalog-pricing.js';
import type { Payments } from '../../src/application/payments.js';
import type { RiskAssessment } from '../../src/application/risk-assessment.js';
import { buildOrderService } from '../../src/bootstrap.js';
import { FakeCatalogPricing } from './fake-catalog-pricing.js';
import { FakePayments } from './fake-payments.js';
import { FakeRiskAssessment } from './fake-risk-assessment.js';
import { draftRequest } from './order-fixtures.js';

/** Sunucunun dis bagimliliklari; verilmeyen sahtesiyle kurulur. */
export interface OrderServerDeps {
  readonly catalog?: CatalogPricing;
  readonly risk?: RiskAssessment;
  readonly payments?: Payments;
}

/**
 * Sunucuyu dosyanin omru boyunca ayakta tutar; tipli unary cagri fonksiyonu doner.
 * Verilmeyen bagimlilik sahtedir: catalog sabit kurallar ve teklifler, risk LOW,
 * odeme test kartlari (fake-payments.ts).
 */
export function useOrderGrpcServer(deps: OrderServerDeps = {}): UnaryCall {
  const catalog = deps.catalog ?? new FakeCatalogPricing();
  const risk = deps.risk ?? new FakeRiskAssessment();
  const payments = deps.payments ?? new FakePayments();
  let server: TestGrpcServer | undefined;

  beforeAll(async () => {
    server = await startTestGrpcServer({
      serviceName: 'order-test',
      services: [buildOrderService({ catalog, risk, payments })],
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

/** Yeni bir taslak acar ve kimligini doner (onkosul adimi; kendisi test edilmez). */
export async function newDraftId(
  call: UnaryCall,
  request: orderV1.CreateDraftOrderRequest = draftRequest,
): Promise<string> {
  const { response } = await call(orderV1.OrderServiceService.createDraftOrder, request);
  return response?.orderId ?? '';
}
