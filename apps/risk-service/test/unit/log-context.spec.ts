/**
 * Log baglami (D2): use-case'in yazdigi satir, istegin x-request-id'sini ve
 * rpc adini tasir. Gercek gRPC sunucusu + gercek istemci; kayit deposu
 * bilerek bozuk, boylece use-case'in error satiri yazilir.
 */

import { fixedClock } from '@getir/core';
import type { LogFields, Logger } from '@getir/core';
import { riskV1 } from '@getir/proto';
import { REQUEST_ID_METADATA_KEY, startGrpcServer } from '@getir/service-kit';
import type { GrpcServerHandle } from '@getir/service-kit';
import { Client, credentials, Metadata } from '@grpc/grpc-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildRiskService } from '../../src/bootstrap.js';
import type { RiskEventRepository } from '../../src/domain/risk-event-repository.js';
import { PERSONA_NOW, PERSONAS } from '../support/personas.js';
import { toProtoContext } from '../support/proto-context.js';

const REQUEST_ID = 'req_log_baglami_risk';

interface LogLine {
  readonly level: string;
  readonly fields: LogFields;
  readonly message: string;
}

/** Alt gunlukcu alanlarini birlestirerek her satiri kaydeder (pino'nun child'i gibi). */
function recordingLogger(lines: LogLine[], bound: LogFields = {}): Logger {
  const write =
    (level: string) =>
    (fields: LogFields, message: string): void => {
      lines.push({ level, fields: { ...bound, ...fields }, message });
    };
  return {
    debug: write('debug'),
    info: write('info'),
    warn: write('warn'),
    error: write('error'),
    fatal: write('fatal'),
    child: (fields) => recordingLogger(lines, { ...bound, ...fields }),
  };
}

const lines: LogLine[] = [];
const brokenEvents: RiskEventRepository = {
  insert: () => Promise.reject(new Error('mongo yok')),
  findLatest: () => Promise.resolve(null),
};

let handle: GrpcServerHandle;
let client: Client;

beforeAll(async () => {
  handle = await startGrpcServer({
    serviceName: 'risk-log-test',
    host: '127.0.0.1',
    port: 0,
    services: [
      buildRiskService({
        clock: fixedClock(PERSONA_NOW),
        events: brokenEvents,
        logger: recordingLogger(lines),
      }),
    ],
  });
  client = new Client(`127.0.0.1:${handle.port}`, credentials.createInsecure());
});

afterAll(async () => {
  client?.close();
  await handle?.shutdown('test bitti');
});

describe('Evaluate - log baglami', () => {
  it("kayit hatasi satiri istegin requestId'sini ve rpc adini tasir", async () => {
    const [persona] = PERSONAS;
    if (persona === undefined) throw new Error('persona yok');
    const metadata = new Metadata();
    metadata.set(REQUEST_ID_METADATA_KEY, REQUEST_ID);
    const method = riskV1.RiskServiceService.evaluate;

    await new Promise<void>((resolve, reject) => {
      client.makeUnaryRequest(
        method.path,
        method.requestSerialize,
        method.responseDeserialize,
        { context: toProtoContext(persona.context) },
        metadata,
        (error) => (error === null ? resolve() : reject(error)),
      );
    });

    const failure = lines.find((line) => line.message.includes('kaydedilemedi'));
    expect(failure).toMatchObject({
      level: 'error',
      fields: { requestId: REQUEST_ID, rpc: 'Evaluate' },
    });
  });
});
