/**
 * Uctan uca kapi testi: gercek bir gRPC sunucusu acilir, gercek bir istemciyle
 * konusulur. Disa bagimlilik yok (Mongo/Redis yok), yalnizca localhost soketi;
 * bu yuzden birim testi klasorunde durur.
 *
 * T2.4'un "Bitti sayilir" olcutunun otomatik karsiligi budur: ornek servis
 * ayaga kalkar ve health cevabi verir. Ayni sey grpcurl ile elle de
 * dogrulanabilir (bkz. packages/service-kit/README.md).
 */

import { ERROR_CODES, GRPC_STATUS } from '@getir/core';
import { Client, credentials } from '@grpc/grpc-js';
import type { ServiceError } from '@grpc/grpc-js';
import { afterEach, describe, expect, it } from 'vitest';

import { ERROR_METADATA_KEY, SERVING_STATUS } from '../../src/config/constants.js';
import {
  BOOM_MESSAGE,
  createEchoImplementation,
  echoServiceDefinition,
  ECHO_SERVICE_NAME,
} from '../../src/example/echo-service.js';
import { healthServiceDefinition } from '../../src/grpc/health.js';
import { startGrpcServer } from '../../src/grpc/server.js';
import type { GrpcServerHandle } from '../../src/grpc/types.js';
import { firstMessage, streamCall, unaryCall } from './support/grpc-client.js';

/** Isletim sistemi bos bir port secsin; testler paralel kosarken cakismaz. */
const EPHEMERAL_PORT = 0;
const SERVED_BY = 'test';

interface HealthResponse {
  status: string;
}

interface EchoResponse {
  message: string;
  servedBy: string;
}

const openClients: Client[] = [];
let openHandle: GrpcServerHandle | undefined;

async function startTestServer(): Promise<{ handle: GrpcServerHandle; client: Client }> {
  const handle = await startGrpcServer({
    serviceName: 'example-test',
    host: '127.0.0.1',
    port: EPHEMERAL_PORT,
    services: [
      {
        name: ECHO_SERVICE_NAME,
        definition: echoServiceDefinition,
        implementation: createEchoImplementation(SERVED_BY),
      },
    ],
  });

  const client = new Client(`127.0.0.1:${handle.port}`, credentials.createInsecure());
  openClients.push(client);
  openHandle = handle;
  return { handle, client };
}

afterEach(async () => {
  for (const client of openClients.splice(0)) {
    client.close();
  }
  await openHandle?.shutdown('test bitti');
  openHandle = undefined;
});

/** Hatanin metadata'sindaki AppError kodunu okur. */
function errorCodeOf(error: Error | undefined): string | undefined {
  const raw = (error as ServiceError | undefined)?.metadata.get(ERROR_METADATA_KEY)[0];
  if (typeof raw !== 'string') {
    return undefined;
  }
  return (JSON.parse(raw) as { code: string }).code;
}

describe('startGrpcServer', () => {
  it('bos port ister ve gercekten baglandigi portu dondurur', async () => {
    const { handle } = await startTestServer();

    expect(handle.port).toBeGreaterThan(0);
  });

  it('health Check butun sunucu icin SERVING doner', async () => {
    const { client } = await startTestServer();

    const result = await unaryCall<{ service: string }, HealthResponse>(
      client,
      healthServiceDefinition,
      'Check',
      { service: '' },
    );

    expect(result.error).toBeUndefined();
    expect(result.response?.status).toBe(SERVING_STATUS.SERVING);
  });

  it('kayitli servis adi icin de ayri satir tutar', async () => {
    const { client } = await startTestServer();

    const result = await unaryCall<{ service: string }, HealthResponse>(
      client,
      healthServiceDefinition,
      'Check',
      { service: ECHO_SERVICE_NAME },
    );

    expect(result.response?.status).toBe(SERVING_STATUS.SERVING);
  });

  it('bilinmeyen servisi NOT_FOUND ile reddeder', async () => {
    const { client } = await startTestServer();

    const result = await unaryCall<{ service: string }, HealthResponse>(
      client,
      healthServiceDefinition,
      'Check',
      { service: 'getir.yok.v1.YokService' },
    );

    expect((result.error as ServiceError | undefined)?.code).toBe(GRPC_STATUS.NOT_FOUND);
  });

  it('ornek RPC gercek cevap doner', async () => {
    const { client } = await startTestServer();

    const result = await unaryCall<{ message: string; repeat: number }, EchoResponse>(
      client,
      echoServiceDefinition,
      'Echo',
      { message: 'merhaba', repeat: 3 },
    );

    expect(result.response).toEqual({ message: 'merhaba merhaba merhaba', servedBy: SERVED_BY });
  });

  it('gecersiz istek INVALID_ARGUMENT ile doner', async () => {
    const { client } = await startTestServer();

    const result = await unaryCall<{ message: string; repeat: number }, EchoResponse>(
      client,
      echoServiceDefinition,
      'Echo',
      { message: '', repeat: 99 },
    );

    expect((result.error as ServiceError | undefined)?.code).toBe(GRPC_STATUS.INVALID_ARGUMENT);
    expect(errorCodeOf(result.error)).toBe(ERROR_CODES.VALIDATION_FAILED);
  });

  it('beklenmeyen hata INTERNAL olur ve ic mesaj disari cikmaz', async () => {
    const { client } = await startTestServer();

    const result = await unaryCall<{ message: string; repeat: number }, EchoResponse>(
      client,
      echoServiceDefinition,
      'Echo',
      { message: BOOM_MESSAGE, repeat: 1 },
    );

    expect((result.error as ServiceError | undefined)?.code).toBe(GRPC_STATUS.INTERNAL);
    expect(result.error?.message).not.toContain('ornek patlama');
    expect(errorCodeOf(result.error)).toBe(ERROR_CODES.INTERNAL);
  });
});

describe('zarif kapanis', () => {
  it('kapanista durumu NOT_SERVING yapar ve Watch akisini bitirir', async () => {
    const { handle, client } = await startTestServer();

    const stream = streamCall<{ service: string }, HealthResponse>(
      client,
      healthServiceDefinition,
      'Watch',
      { service: '' },
    );
    expect((await firstMessage(stream)).status).toBe(SERVING_STATUS.SERVING);

    const ended = new Promise<void>((resolve) => stream.once('end', resolve));
    await handle.shutdown('test');

    expect(handle.health.getStatus('')).toBe(SERVING_STATUS.NOT_SERVING);
    expect(handle.health.getStatus(ECHO_SERVICE_NAME)).toBe(SERVING_STATUS.NOT_SERVING);
    await ended;
  });

  it('iki kez cagrilmasi hata vermez', async () => {
    const { handle } = await startTestServer();

    await expect(Promise.all([handle.shutdown('bir'), handle.shutdown('iki')])).resolves.toEqual([
      undefined,
      undefined,
    ]);
  });

  it('kapanis kancasi sunucu kapandiktan SONRA calisir', async () => {
    // Kanca calistiginda durum ARTIK NOT_SERVING olmali: onceligi sunucunun
    // bosalmasi, en sonda veritabani baglantilarini kapatmak.
    const seen: (string | undefined)[] = [];
    // Kanca sunucu nesnesini kurulmadan once gormek zorunda; tutamak bir
    // kap uzerinden paylasiliyor.
    const holder: { handle?: GrpcServerHandle } = {};
    const handle = await startGrpcServer({
      serviceName: 'example-test',
      host: '127.0.0.1',
      port: EPHEMERAL_PORT,
      services: [],
      onShutdown: () => {
        seen.push(holder.handle?.health.getStatus(''));
      },
    });
    holder.handle = handle;
    openHandle = handle;

    await handle.shutdown('test');

    expect(seen).toEqual([SERVING_STATUS.NOT_SERVING]);
  });
});
