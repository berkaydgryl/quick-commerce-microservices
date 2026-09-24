/**
 * Uctan uca kapi testi: gercek gRPC sunucusu + gercek istemci. Personalar
 * proto mesaji olarak gonderilir; T6.3 "bitti sayilir" (kayit sorgulanabilir)
 * GetLastEvaluation ile dogrulanir.
 */

import { ERROR_CODES, fixedClock, GRPC_STATUS } from '@getir/core';
import { riskV1 } from '@getir/proto';
import { ERROR_METADATA_KEY, startGrpcServer } from '@getir/service-kit';
import type { GrpcServerHandle } from '@getir/service-kit';
import { Client, credentials, Metadata } from '@grpc/grpc-js';
import type { MethodDefinition, ServiceError } from '@grpc/grpc-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { buildRiskService } from '../../src/bootstrap.js';
import { PERSONA_NOW, PERSONAS } from '../support/personas.js';
import { toProtoContext } from '../support/proto-context.js';

let handle: GrpcServerHandle;
let client: Client;

function call<TRequest, TResponse>(
  method: MethodDefinition<TRequest, TResponse>,
  request: TRequest,
): Promise<{ error: ServiceError | undefined; response: TResponse | undefined }> {
  return new Promise((resolve) => {
    client.makeUnaryRequest(
      method.path,
      method.requestSerialize,
      method.responseDeserialize,
      request,
      new Metadata(),
      (error, response) => resolve({ error: error ?? undefined, response: response ?? undefined }),
    );
  });
}

const appErrorSchema = z.object({ code: z.string() });
function errorCodeOf(error: ServiceError | undefined): string | undefined {
  const raw = error?.metadata.get(ERROR_METADATA_KEY)[0];
  if (typeof raw !== 'string') return undefined;
  const parsed = appErrorSchema.safeParse(JSON.parse(raw));
  return parsed.success ? parsed.data.code : undefined;
}

const BAND = {
  LOW: riskV1.RiskBand.RISK_BAND_LOW,
  MEDIUM: riskV1.RiskBand.RISK_BAND_MEDIUM,
  HIGH: riskV1.RiskBand.RISK_BAND_HIGH,
  CRITICAL: riskV1.RiskBand.RISK_BAND_CRITICAL,
} as const;

beforeAll(async () => {
  handle = await startGrpcServer({
    serviceName: 'risk-test',
    host: '127.0.0.1',
    port: 0,
    services: [buildRiskService({ clock: fixedClock(PERSONA_NOW) })],
  });
  client = new Client(`127.0.0.1:${handle.port}`, credentials.createInsecure());
});

afterAll(async () => {
  client?.close();
  await handle?.shutdown('test bitti');
});

describe('RiskService/Evaluate - personalar gercek telden', () => {
  it.each(PERSONAS.map((persona) => [persona.name, persona] as const))('%s', async (_, persona) => {
    const { error, response } = await call(riskV1.RiskServiceService.evaluate, {
      context: toProtoContext(persona.context),
    });

    expect(error).toBeUndefined();
    expect(response?.evaluation?.score).toBe(persona.expected.score);
    expect(response?.evaluation?.band).toBe(BAND[persona.expected.band]);
    expect(response?.evaluation?.vetoedByRuleId).toBe(persona.expected.vetoedByRuleId ?? '');
    expect(response?.evaluation?.hits).toHaveLength(6);
  });

  it('yalnizca kullanici kimligi gonderilirse kimse "bot" sayilmaz (dwell 0 = olculmedi)', async () => {
    const { response } = await call(riskV1.RiskServiceService.evaluate, {
      context: { ...riskV1.RiskContext.fromPartial({}), userId: 'usr_bos', deliveredOrderCount: 3 },
    });

    const dwell = response?.evaluation?.hits.find((hit) => hit.ruleId === 'checkout-dwell');
    expect(dwell?.hit).toBe(false);
    expect(response?.evaluation?.score).toBe(0);
  });

  it('gecersiz istek INVALID_ARGUMENT + VALIDATION_FAILED', async () => {
    const { error } = await call(riskV1.RiskServiceService.evaluate, { context: undefined });

    expect(error?.code).toBe(GRPC_STATUS.INVALID_ARGUMENT);
    expect(errorCodeOf(error)).toBe(ERROR_CODES.VALIDATION_FAILED);
  });
});

describe('RiskService/GetLastEvaluation - kayit sorgulanabilir (T6.3)', () => {
  it('Evaluate sonrasi "bu siparis neden engellendi" tek cagriyla cevaplanir', async () => {
    const ali = PERSONAS.find((persona) => persona.name.startsWith('Ali'));
    if (ali === undefined) throw new Error('Ali personasi yok');
    await call(riskV1.RiskServiceService.evaluate, {
      context: { ...toProtoContext(ali.context), orderId: 'ord_ali-1' },
    });

    const { error, response } = await call(riskV1.RiskServiceService.getLastEvaluation, {
      userId: ali.context.userId,
      orderId: 'ord_ali-1',
    });

    expect(error).toBeUndefined();
    expect(response?.evaluation).toMatchObject({
      score: 45,
      band: BAND.CRITICAL,
      vetoedByRuleId: 'ip-device',
    });
    const vetoHit = response?.evaluation?.hits.find((hit) => hit.veto);
    expect(vetoHit).toMatchObject({ ruleId: 'ip-device', reason: 'cihazda 4 hesap' });
    expect(response?.evaluation?.evaluatedAt).toEqual(new Date(PERSONA_NOW));
  });

  it('kaydi olmayan kullanici NOT_FOUND', async () => {
    const { error } = await call(riskV1.RiskServiceService.getLastEvaluation, {
      userId: 'usr_yok',
      orderId: '',
    });

    expect(error?.code).toBe(GRPC_STATUS.NOT_FOUND);
  });
});
