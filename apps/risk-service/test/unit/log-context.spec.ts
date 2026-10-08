/**
 * Log baglami (D2): use-case'in yazdigi satir, istegin x-request-id'sini ve
 * rpc adini tasir. Gercek gRPC sunucusu + gercek istemci; kayit deposu
 * bilerek bozuk, boylece use-case'in error satiri yazilir.
 */

import { fixedClock } from '@getir/core';
import { recordingLogger } from '@getir/core/testing';
import type { LogLine } from '@getir/core/testing';
import { riskV1 } from '@getir/proto';
import { REQUEST_ID_METADATA_KEY } from '@getir/service-kit';
import { startTestGrpcServer } from '@getir/service-kit/testing';
import type { TestGrpcServer } from '@getir/service-kit/testing';
import { Metadata } from '@grpc/grpc-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildRiskService } from '../../src/bootstrap.js';
import type {
  RecentRiskEvents,
  RiskEventRepository,
} from '../../src/domain/risk-event-repository.js';
import { PERSONA_NOW, PERSONAS } from '../support/personas.js';
import { toProtoContext } from '../support/proto-context.js';

const REQUEST_ID = 'req_log_baglami_risk';

const lines: LogLine[] = [];
const brokenEvents: RiskEventRepository & RecentRiskEvents = {
  insert: () => Promise.reject(new Error('mongo yok')),
  findLatest: () => Promise.resolve(null),
  findHighestRecent: () => Promise.resolve(null),
};

let server: TestGrpcServer;

beforeAll(async () => {
  server = await startTestGrpcServer({
    serviceName: 'risk-log-test',
    services: [
      buildRiskService({
        clock: fixedClock(PERSONA_NOW),
        events: brokenEvents,
        logger: recordingLogger(lines),
      }),
    ],
  });
});

afterAll(async () => {
  await server?.stop();
});

describe('Evaluate - log baglami', () => {
  it("kayit hatasi satiri istegin requestId'sini ve rpc adini tasir", async () => {
    const [persona] = PERSONAS;
    if (persona === undefined) throw new Error('persona yok');
    const metadata = new Metadata();
    metadata.set(REQUEST_ID_METADATA_KEY, REQUEST_ID);

    const { error } = await server.call(
      riskV1.RiskServiceService.evaluate,
      { context: toProtoContext(persona.context) },
      metadata,
    );

    expect(error).toBeUndefined();
    const failure = lines.find((line) => line.message.includes('kaydedilemedi'));
    expect(failure).toMatchObject({
      level: 'error',
      fields: { requestId: REQUEST_ID, rpc: 'Evaluate' },
    });
  });
});
