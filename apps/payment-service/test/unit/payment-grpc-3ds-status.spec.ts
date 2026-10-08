/**
 * GetPayment'in 3DS durumu (#163 B1) gercek telden, gercek akisla: acik ->
 * yanlis kod (hak azalir) -> hak biter (kapali, jeton yok); suresi dolar (jeton
 * yok, hak kalir); dogru kod ya da kart reddi (durum yok).
 *
 * GUVENLIK (QA #207 notu): challengeId bir yetenek jetonudur; hicbir gunluk
 * satirinda, hata ayrintisinda ya da metrik ciktisinda gorunmez.
 */

import { fixedClock, MOCK_THREEDS_CODE } from '@getir/core';
import { recordingLogger } from '@getir/core/testing';
import type { LogLine } from '@getir/core/testing';
import { metricsRegistry } from '@getir/observability';
import { paymentV1 } from '@getir/proto';
import { appErrorOf, unaryCall } from '@getir/service-kit/testing';
import type { CallResult } from '@getir/service-kit/testing';
import type { MethodDefinition } from '@grpc/grpc-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { THREEDS_CHALLENGE_TTL_MS, THREEDS_MAX_ATTEMPTS } from '../../src/config/constants.js';
import { startPaymentService } from '../support/payment-grpc-client.js';
import type { RunningPaymentService } from '../support/payment-grpc-client.js';

const NOW = Date.parse('2026-10-08T09:00:00.000Z');
/** Mock saglayicinin bekledigi koddan (MOCK_THREEDS_CODE) farkli, bicimi gecerli kod. */
const WRONG_CODE = '000000';

const clock = fixedClock(NOW);
const lines: LogLine[] = [];
let service: RunningPaymentService;

function call<TRequest, TResponse>(
  method: MethodDefinition<TRequest, TResponse>,
  request: TRequest,
): Promise<CallResult<TResponse>> {
  return unaryCall(service.client, method, request);
}

let sequence = 0;
async function charge(cardToken: string) {
  sequence += 1;
  const orderId = `ord_3ds_durum_${String(sequence)}`;
  const { response } = await call(paymentV1.PaymentServiceService.charge, {
    orderId,
    userId: 'usr_3ds',
    amount: { amountMinor: 12_990, currency: 'TRY' },
    method: paymentV1.PaymentMethod.PAYMENT_METHOD_CARD,
    cardToken,
    cardId: '',
    idempotencyKey: `anahtar-3ds-durum-${String(sequence)}`,
    requireThreeDs: false,
  });
  return { orderId, response };
}

async function confirm(orderId: string, challengeId: string, code: string) {
  return call(paymentV1.PaymentServiceService.confirm3Ds, { orderId, challengeId, code });
}

async function threeDsOf(orderId: string) {
  const { error, response } = await call(paymentV1.PaymentServiceService.getPayment, { orderId });
  expect(error).toBeUndefined();
  return response;
}

/** Hata nesnelerini de (mesaj, yigin, cause) yazan serilestirme: gunlukcu gibi. */
function serialized(value: unknown): string {
  return JSON.stringify(value, (_key, field: unknown) =>
    field instanceof Error
      ? { name: field.name, message: field.message, stack: field.stack, cause: field.cause }
      : field,
  );
}

beforeAll(async () => {
  service = await startPaymentService(
    { clock, logger: recordingLogger(lines) },
    'payment-3ds-durum',
  );
});

afterAll(async () => {
  await service?.stop();
});

describe('GetPayment three_ds (#163 B1)', () => {
  it('acik -> yanlis kod (hak azalir, jeton ayni) -> hak biter (FAILED, jeton yok, hak 0)', async () => {
    clock.set(NOW);
    const { orderId, response } = await charge('tok_test_3184');
    const challengeId = response?.challengeId ?? '';

    expect((await threeDsOf(orderId))?.threeDs).toEqual({
      challengeId,
      expiresAt: response?.challengeExpiresAt,
      attemptsLeft: THREEDS_MAX_ATTEMPTS,
    });

    await confirm(orderId, challengeId, WRONG_CODE);
    expect((await threeDsOf(orderId))?.threeDs).toMatchObject({
      challengeId,
      attemptsLeft: THREEDS_MAX_ATTEMPTS - 1,
    });

    for (let attempt = 1; attempt < THREEDS_MAX_ATTEMPTS; attempt += 1) {
      await confirm(orderId, challengeId, WRONG_CODE);
    }
    const closed = await threeDsOf(orderId);
    expect(closed?.payment?.status).toBe(paymentV1.PaymentStatus.PAYMENT_STATUS_FAILED);
    expect(closed?.threeDs).toEqual({
      challengeId: '',
      expiresAt: response?.challengeExpiresAt,
      attemptsLeft: 0,
    });
  });

  it('suresi dolunca jeton yok, hak kalir (odeme hala REQUIRES_3DS)', async () => {
    clock.set(NOW);
    const { orderId } = await charge('tok_test_3184');

    clock.set(NOW + THREEDS_CHALLENGE_TTL_MS);
    const read = await threeDsOf(orderId);

    expect(read?.payment?.status).toBe(paymentV1.PaymentStatus.PAYMENT_STATUS_REQUIRES_3DS);
    expect(read?.threeDs).toMatchObject({ challengeId: '', attemptsLeft: THREEDS_MAX_ATTEMPTS });
  });

  it('dogru kodla basarili, dogrudan onay ve kart reddinde durum YOK', async () => {
    clock.set(NOW);
    const challenged = await charge('tok_test_3184');
    await confirm(challenged.orderId, challenged.response?.challengeId ?? '', MOCK_THREEDS_CODE);
    const approved = await charge('tok_test_4242');
    const declined = await charge('tok_test_0002');

    for (const orderId of [challenged.orderId, approved.orderId, declined.orderId]) {
      expect((await threeDsOf(orderId))?.threeDs).toBeUndefined();
    }
  });

  it('GUVENLIK: jeton hicbir gunluk satirinda, hata mesaji/ayrintisinda ya da metrik ciktisinda yok', async () => {
    // Kendi icinde: onceki testlerin durumuna dayanmaz.
    lines.length = 0;
    clock.set(NOW);
    const { orderId, response } = await charge('tok_test_3184');
    const challengeId = response?.challengeId ?? '';
    const wrong = await call(paymentV1.PaymentServiceService.confirm3Ds, {
      orderId,
      challengeId,
      code: WRONG_CODE,
    });
    const open = await threeDsOf(orderId);
    const missing = await call(paymentV1.PaymentServiceService.getPayment, {
      orderId: 'ord_3ds_durum_yok',
    });
    clock.set(NOW + THREEDS_CHALLENGE_TTL_MS);
    await threeDsOf(orderId);

    expect(challengeId).toMatch(/^tds_[0-9a-f]{32}$/);
    expect(open?.threeDs?.challengeId).toBe(challengeId);
    expect(wrong.error).toBeDefined();
    expect(missing.error).toBeDefined();
    expect(lines.length).toBeGreaterThan(0);
    const exposed = [
      serialized(lines),
      ...[wrong.error, missing.error].flatMap((error) => [
        error?.message ?? '',
        error?.details ?? '',
        serialized(appErrorOf(error)),
      ]),
      await metricsRegistry.metrics(),
    ];
    for (const text of exposed) {
      expect(text).not.toContain(challengeId);
    }
  });
});
