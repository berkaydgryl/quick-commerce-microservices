/**
 * order -> risk gRPC istemcisi (T7.1), GERCEK tel uzerinden: sahte bir risk
 * sunucusu ayaga kalkar. Baglam cevirisi, bant cevirisi, requestId iletimi ve
 * sure siniri denenir.
 */

import { AppError, ERROR_CODES, RISK_BANDS, silentLogger } from '@getir/core';
import { riskV1 } from '@getir/proto';
import { REQUEST_ID_METADATA_KEY, startGrpcServer } from '@getir/service-kit';
import type { GrpcServerHandle } from '@getir/service-kit';
import type { sendUnaryData, ServerUnaryCall } from '@grpc/grpc-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { OrderRiskContext } from '../../src/domain/checkout-risk.js';
import { GrpcRiskAssessment } from '../../src/infrastructure/risk/grpc-risk-assessment.js';

const TIMEOUT_MS = 200;
const scope = { requestId: 'req_risk_1', logger: silentLogger };

/** Sunucunun gordugu istekler ve x-request-id degerleri. */
const seen: { context: riskV1.RiskContext | undefined; requestId: unknown }[] = [];

const BANDSIZ_USER = 'usr_bantsiz';
const YAVAS_USER = 'usr_yavas';

const implementation = {
  evaluate: (
    call: ServerUnaryCall<riskV1.EvaluateRequest, riskV1.EvaluateResponse>,
    callback: sendUnaryData<riskV1.EvaluateResponse>,
  ): void => {
    seen.push({
      context: call.request.context,
      requestId: call.metadata.get(REQUEST_ID_METADATA_KEY)[0],
    });
    const userId = call.request.context?.userId;
    const band =
      userId === BANDSIZ_USER
        ? riskV1.RiskBand.RISK_BAND_UNSPECIFIED
        : riskV1.RiskBand.RISK_BAND_MEDIUM;
    const respond = () =>
      callback(null, {
        evaluation: riskV1.RiskEvaluation.fromPartial({ score: 35, band }),
      });
    if (userId === YAVAS_USER) setTimeout(respond, TIMEOUT_MS * 3);
    else respond();
  },
};

let handle: GrpcServerHandle;
let risk: GrpcRiskAssessment;

beforeAll(async () => {
  handle = await startGrpcServer({
    serviceName: 'fake-risk',
    host: '127.0.0.1',
    port: 0,
    services: [
      { name: 'getir.risk.v1.RiskService', definition: riskV1.RiskServiceService, implementation },
    ],
  });
  risk = new GrpcRiskAssessment(`127.0.0.1:${handle.port}`, TIMEOUT_MS);
});

afterAll(async () => {
  risk?.close();
  await handle?.shutdown('test bitti');
});

const context = (overrides: Partial<OrderRiskContext> = {}): OrderRiskContext => ({
  userId: 'usr_1',
  orderId: 'ord_1',
  marketId: 'mkt_migros-jet-moda',
  deliveredOrderCount: 0,
  cancelledOrderCount: 1,
  basketTotalMinor: 7_990,
  currency: 'TRY',
  checkoutDwellMs: 45_000,
  deliveryLocation: { lat: 40.9885, lng: 29.0262 },
  ...overrides,
});

async function rejectionOf(promise: Promise<unknown>): Promise<AppError> {
  const error = await promise.then(
    () => undefined,
    (reason: unknown) => reason,
  );
  if (error instanceof AppError) return error;
  throw new Error('AppError beklenirdi');
}

describe('GrpcRiskAssessment', () => {
  it('bant ve skor core sozlugune cevrilir; requestId AYNEN iletilir', async () => {
    await expect(risk.evaluate(context(), scope)).resolves.toEqual({
      band: RISK_BANDS.MEDIUM,
      score: 35,
    });
    expect(seen.at(-1)?.requestId).toBe(scope.requestId);
  });

  it('order in bildigi alanlar telde; bilmedikleri (IP, cihaz, hesap yasi) BOS gider', async () => {
    await risk.evaluate(context({ userAverageBasketMinor: 12_000 }), scope);

    expect(seen.at(-1)?.context).toEqual(
      riskV1.RiskContext.fromPartial({
        userId: 'usr_1',
        orderId: 'ord_1',
        marketId: 'mkt_migros-jet-moda',
        deliveredOrderCount: 0,
        cancelledOrderCount: 1,
        basketTotal: { amountMinor: 7_990, currency: 'TRY' },
        userAverageBasket: { amountMinor: 12_000, currency: 'TRY' },
        checkoutDwellMs: 45_000,
        deliveryLocation: { lat: 40.9885, lng: 29.0262 },
      }),
    );
  });

  it('ortalama sepet yoksa mesaj HIC gonderilmez ("ortalama 0" sepet anomalisi sayilirdi)', async () => {
    await risk.evaluate(context(), scope);

    expect(seen.at(-1)?.context?.userAverageBasket).toBeUndefined();
  });

  it('bantsiz cevapla siparis ilerletilmez: INTERNAL', async () => {
    const error = await rejectionOf(risk.evaluate(context({ userId: BANDSIZ_USER }), scope));

    expect(error.code).toBe(ERROR_CODES.INTERNAL);
  });

  it('sure siniri dolarsa SERVICE_UNAVAILABLE', async () => {
    const error = await rejectionOf(risk.evaluate(context({ userId: YAVAS_USER }), scope));

    expect(error.code).toBe(ERROR_CODES.SERVICE_UNAVAILABLE);
  });
});
