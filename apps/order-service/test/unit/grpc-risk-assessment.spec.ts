/**
 * order -> risk gRPC istemcisi (T7.1), GERCEK tel uzerinden: sahte bir risk
 * sunucusu ayaga kalkar. Baglam cevirisi, bant cevirisi, requestId iletimi ve
 * sure siniri denenir.
 */

import { AppError, ERROR_CODES, RISK_BANDS, silentLogger } from '@getir/core';
import { riskV1 } from '@getir/proto';
import {
  CircuitBreaker,
  REQUEST_ID_METADATA_KEY,
  startGrpcServer,
  toServiceError,
} from '@getir/service-kit';
import type { GrpcServerHandle } from '@getir/service-kit';
import type { sendUnaryData, ServerUnaryCall } from '@grpc/grpc-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { OrderRiskContext } from '../../src/domain/checkout-risk.js';
import { GrpcRiskAssessment } from '../../src/infrastructure/risk/grpc-risk-assessment.js';

/**
 * Islevsel testlerin suresi COMERT (D17): ilk cagri kanal kurulumunu da oder ve
 * yuklu makinede 200 ms'yi asabiliyordu ("Deadline exceeded after 0.201s").
 * Bu testler sureyi degil ceviriyi siner; dayaniklilik testinde de yeniden
 * denemeyi kalan sure degil kural engellemeli.
 */
const FUNCTIONAL_TIMEOUT_MS = 5_000;
/** Yalnizca sure siniri testinin kisa siniri; yavas kullanicinin cevabi HIC gelmez. */
const DEADLINE_TIMEOUT_MS = 200;
/**
 * Sure testinin deneme siniri: yuklu makinede ilk deneme kanal kurulumunda
 * kesilebilir (istek sunucuya ulasmaz); istek ULASANA kadar tekrarlanir.
 */
const REACH_ATTEMPTS = 20;
const scope = { requestId: 'req_risk_1', logger: silentLogger };

/** Sunucunun gordugu istekler ve x-request-id degerleri. */
const seen: { context: riskV1.RiskContext | undefined; requestId: unknown }[] = [];

const BANDSIZ_USER = 'usr_bantsiz';
/** Ilk Evaluate'i "ulasilamaz" donen kullanici (D17): kac cagri gordugu sayilir. */
const KESIK_USER = 'usr_kesik';
let kesikCalls = 0;
const YAVAS_USER = 'usr_yavas';
/** Yavas kullanicinin bekletilen cevaplari: sunucu cevap VERMEZ, istek gelmis olur. */
const heldSlowReplies: (() => void)[] = [];

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
    if (userId === KESIK_USER) {
      kesikCalls += 1;
      if (kesikCalls === 1) {
        callback(
          toServiceError(new AppError(ERROR_CODES.SERVICE_UNAVAILABLE, 'risk gecici kapali')),
        );
        return;
      }
    }
    const band =
      userId === BANDSIZ_USER
        ? riskV1.RiskBand.RISK_BAND_UNSPECIFIED
        : riskV1.RiskBand.RISK_BAND_MEDIUM;
    const respond = () =>
      callback(null, {
        evaluation: riskV1.RiskEvaluation.fromPartial({ score: 35, band }),
      });
    if (userId === YAVAS_USER) heldSlowReplies.push(respond);
    else respond();
  },
};

let handle: GrpcServerHandle;
let risk: GrpcRiskAssessment;
let shortDeadline: GrpcRiskAssessment;

beforeAll(async () => {
  handle = await startGrpcServer({
    serviceName: 'fake-risk',
    host: '127.0.0.1',
    port: 0,
    services: [
      { name: 'getir.risk.v1.RiskService', definition: riskV1.RiskServiceService, implementation },
    ],
  });
  risk = new GrpcRiskAssessment(`127.0.0.1:${handle.port}`, FUNCTIONAL_TIMEOUT_MS);
  shortDeadline = new GrpcRiskAssessment(`127.0.0.1:${handle.port}`, DEADLINE_TIMEOUT_MS);
});

afterAll(async () => {
  for (const respond of heldSlowReplies.splice(0)) respond();
  risk?.close();
  shortDeadline?.close();
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
  signals: {},
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

  it('gateway sinyalleri (T7.5) RiskContext te ayni adli alanlara gider', async () => {
    const accountCreatedAt = new Date('2026-09-01T00:00:00.000Z');
    await risk.evaluate(
      context({
        signals: {
          ipAddress: '85.105.1.20',
          ipCity: 'Istanbul',
          deviceId: 'dev_1',
          accountsOnDevice: 2,
          previousIpAddress: '85.105.1.19',
          sessionLocation: { lat: 41.0, lng: 29.0 },
          accountCreatedAt,
        },
      }),
      scope,
    );

    expect(seen.at(-1)?.context).toMatchObject({
      ipAddress: '85.105.1.20',
      ipCity: 'Istanbul',
      deviceId: 'dev_1',
      accountsOnDevice: 2,
      previousIpAddress: '85.105.1.19',
      sessionLocation: { lat: 41.0, lng: 29.0 },
      accountCreatedAt,
    });
  });

  it('gelmeyen sinyal bos gider; konum ve zaman mesaji HIC gonderilmez ((0,0) gecerli nokta sayilirdi)', async () => {
    await risk.evaluate(context({ signals: { ipAddress: '85.105.1.20' } }), scope);

    const sent = seen.at(-1)?.context;
    expect(sent).toMatchObject({ ipAddress: '85.105.1.20', deviceId: '', accountsOnDevice: 0 });
    expect(sent?.sessionLocation).toBeUndefined();
    expect(sent?.accountCreatedAt).toBeUndefined();
  });

  it('bantsiz cevapla siparis ilerletilmez: INTERNAL', async () => {
    const error = await rejectionOf(risk.evaluate(context({ userId: BANDSIZ_USER }), scope));

    expect(error.code).toBe(ERROR_CODES.INTERNAL);
  });

  it('sure siniri dolarsa SERVICE_UNAVAILABLE', async () => {
    for (let attempt = 1; ; attempt += 1) {
      const before = heldSlowReplies.length;
      const error = await rejectionOf(
        shortDeadline.evaluate(context({ userId: YAVAS_USER }), scope),
      );

      expect(error.code).toBe(ERROR_CODES.SERVICE_UNAVAILABLE);
      // Istek sunucuya ULASTI: kesilen, baglanti kurulumu degil bekleyen cevaptir.
      if (heldSlowReplies.length > before) return;
      if (attempt === REACH_ATTEMPTS) throw new Error('yavas istek sunucuya hic ulasmadi');
    }
  });
});

describe('GrpcRiskAssessment - dayaniklilik (D17)', () => {
  it('Evaluate yeniden DENENMEZ: her cagri risk-svc te yeni bir degerlendirme kaydi yazar', async () => {
    kesikCalls = 0;
    const resilient = new GrpcRiskAssessment(`127.0.0.1:${handle.port}`, FUNCTIONAL_TIMEOUT_MS, {
      breaker: new CircuitBreaker({ target: 'risk', failureThreshold: 5, openMs: 60_000 }),
      retry: { target: 'risk', maxRetries: 2, baseDelayMs: 1 },
    });
    try {
      const error = await rejectionOf(resilient.evaluate(context({ userId: KESIK_USER }), scope));

      expect(error.code).toBe(ERROR_CODES.SERVICE_UNAVAILABLE);
      expect(kesikCalls).toBe(1);
    } finally {
      resilient.close();
    }
  });
});
