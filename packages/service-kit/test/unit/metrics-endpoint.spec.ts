/**
 * Metrik ucu (T10.5): startGrpcServer gRPC portu + 1000'de (testte bos port)
 * HTTP /metrics acar, RPC sayaclari `service` etiketiyle gorunur ve zarif
 * kapanista uc da kapanir. Gercek sunucu + gercek istemci, yalnizca localhost.
 */

import { createServer } from 'node:net';
import type { AddressInfo, Server } from 'node:net';

import { metricsRegistry } from '@getir/observability';
import { Client, credentials } from '@grpc/grpc-js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { METRICS_PORT_OFFSET } from '../../src/config/constants.js';
import { MAX_GRPC_PORT, MAX_PORT } from '../../src/config/env.js';
import {
  createEchoImplementation,
  echoServiceDefinition,
  ECHO_SERVICE_NAME,
} from '../../src/example/echo-service.js';
import { metricsPortFor, openMetricsEndpoint } from '../../src/grpc/metrics-endpoint.js';
import { startGrpcServer } from '../../src/grpc/server.js';
import type { GrpcServerHandle } from '../../src/grpc/types.js';
import { silentLogger } from '../../src/logger.js';
import { callByName } from './support/grpc-client.js';

const HOST = '127.0.0.1';
const SERVICE = 'metrik-test';

const handles: GrpcServerHandle[] = [];
const clients: Client[] = [];

beforeEach(() => {
  metricsRegistry.resetMetrics();
});

afterEach(async () => {
  for (const client of clients.splice(0)) {
    client.close();
  }
  await Promise.all(handles.splice(0).map((handle) => handle.shutdown('test bitti')));
});

async function start(port = 0): Promise<GrpcServerHandle> {
  const handle = await startGrpcServer({
    serviceName: SERVICE,
    host: HOST,
    port,
    services: [
      {
        name: ECHO_SERVICE_NAME,
        definition: echoServiceDefinition,
        implementation: createEchoImplementation('test'),
      },
    ],
  });
  handles.push(handle);
  return handle;
}

function metricsUrl(handle: GrpcServerHandle): string {
  return `http://${HOST}:${handle.metricsPort}/metrics`;
}

describe('metrik portu kurali', () => {
  it('gRPC portu + 1000 (catalog 50051 -> 51051); port 0 ise 0', () => {
    expect(METRICS_PORT_OFFSET).toBe(1_000);
    expect(metricsPortFor(50_051)).toBe(51_051);
    expect(metricsPortFor(50_055)).toBe(51_055);
    expect(metricsPortFor(0)).toBe(0);
  });

  it('metrik portu 65535i asacaksa uc acilmaz (ortam semasi da gRPC portunu sinirlar)', async () => {
    expect(MAX_GRPC_PORT).toBe(MAX_PORT - METRICS_PORT_OFFSET);

    await expect(
      openMetricsEndpoint({
        serviceName: SERVICE,
        host: HOST,
        grpcPort: MAX_GRPC_PORT + 1,
        logger: silentLogger,
      }),
    ).rejects.toThrow(/metrik portu 65536 gecersiz/);
  });
});

describe('startGrpcServer: metrik ucu', () => {
  it('/metrics RPC sayacini rpc, code ve service etiketleriyle gosterir', async () => {
    const handle = await start();
    const client = new Client(`${HOST}:${handle.port}`, credentials.createInsecure());
    clients.push(client);

    await callByName(client, echoServiceDefinition, 'Echo', { message: 'merhaba', repeat: 1 });
    await callByName(client, echoServiceDefinition, 'Echo', { message: '', repeat: 1 });

    const response = await fetch(metricsUrl(handle));
    const text = await response.text();
    expect(response.status).toBe(200);
    expect(handle.metricsPort).not.toBe(handle.port);
    expect(sampleLine(text, 'grpc_server_requests_total', { rpc: 'Echo', code: 'OK' })).toMatch(
      / 1$/,
    );
    expect(
      sampleLine(text, 'grpc_server_requests_total', { rpc: 'Echo', code: 'VALIDATION_FAILED' }),
    ).toMatch(/ 1$/);
    expect(sampleLine(text, 'grpc_server_request_duration_seconds_count', { code: 'OK' })).toMatch(
      / 1$/,
    );
    // Node surec metrikleri de ayni uctan.
    expect(sampleLine(text, 'process_resident_memory_bytes', {})).toBeDefined();
  });

  it('zarif kapanista metrik ucu da kapanir', async () => {
    const handle = await start();
    expect((await fetch(metricsUrl(handle))).status).toBe(200);

    await handle.shutdown('test');

    await expect(fetch(metricsUrl(handle))).rejects.toMatchObject({
      cause: { code: 'ECONNREFUSED' },
    });
  });

  it('metrik portu doluysa acilis durur ve acilmis gRPC portu birakilir', async () => {
    const { grpcPort, metricsBlocker } = await occupyMetricsPort();
    try {
      await expect(start(grpcPort)).rejects.toThrow(/metrik portu acilamadi/);

      // gRPC portu askida kalmadi: ayni porta yeniden baglanilabiliyor.
      await expect(listenOn(grpcPort).then(closeServer)).resolves.toBeUndefined();
    } finally {
      await closeServer(metricsBlocker);
    }
  });
});

/** `ad{...} deger` satirlarindan etiketleri iceren ilkini bulur (etiket sirasi onemsiz). */
function sampleLine(
  text: string,
  name: string,
  labels: Readonly<Record<string, string>>,
): string | undefined {
  const wanted = [...Object.entries(labels), ['service', SERVICE]].map(
    ([key, value]) => `${key}="${value}"`,
  );
  return text
    .split('\n')
    .find((line) => line.startsWith(`${name}{`) && wanted.every((part) => line.includes(part)));
}

/**
 * Metrik portu (P + 1000) dolu, gRPC portu (P) bos bir cift bulur. Isletim
 * sisteminin verdigi bos porttan geriye sayar; P bos degilse sonraki denenir.
 */
async function occupyMetricsPort(): Promise<{ grpcPort: number; metricsBlocker: Server }> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const metricsBlocker = await listenOn(0);
    const grpcPort = (metricsBlocker.address() as AddressInfo).port - METRICS_PORT_OFFSET;
    const free = await listenOn(grpcPort).then(
      async (server) => {
        await closeServer(server);
        return true;
      },
      () => false,
    );
    if (free && grpcPort > 0) {
      return { grpcPort, metricsBlocker };
    }
    await closeServer(metricsBlocker);
  }
  throw new Error('bos port cifti bulunamadi');
}

function listenOn(port: number): Promise<Server> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(port, HOST, () => {
      server.off('error', reject);
      resolve(server);
    });
  });
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}
