/**
 * QA kara kutu (T13.2 PR 3, #124; QA Q6): COURIER_SPEED_KMH servisin GERCEK
 * acilisinda (dist/main.js, MOCK=true: demo kuryeleri bellekte, Docker yok).
 * Backend'in env testi semayi, gRPC testi hizi bootstrap'a elle vererek sinar;
 * burada ortam degiskeninden tel uzerindeki ETA'ya butun zincir:
 *
 *   - 1, varsayilan (yok) ve 120 km/sa: servis acilir; atamanin ETA'si
 *     StartRoute'un distance_meters'indan o hizla hesaplanan deger.
 *   - 0, 121, "20.5", "abc": servis ACILMAZ; cikis kodu 1, tek satir fatal
 *     JSON gunlugu (issues icinde COURIER_SPEED_KMH), "hazir" satiri yok.
 *
 * CI'da `pnpm build` entegrasyon testlerinden once kosar; yerelde once derleyin.
 */

import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';

import { ID_PREFIX, newId } from '@getir/core';
import { courierV1 } from '@getir/proto';
import { METRICS_PORT_OFFSET } from '@getir/service-kit';
import { unaryCall } from '@getir/service-kit/testing';
import { Client, credentials } from '@grpc/grpc-js';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { DEFAULT_COURIER_SPEED_KMH } from '../../src/config/constants.js';
import { DELIVERY, MARKET } from '../support/couriers.js';

const MAIN_ENTRY = fileURLToPath(new URL('../../dist/main.js', import.meta.url));
const READY_MESSAGE = 'kurye servisi hazir';
const START_TIMEOUT_MS = 20_000;
const LOCALHOST = '127.0.0.1';
const PORT_MIN = 20_000;
const PORT_SPAN = 40_000;

const service = courierV1.CourierServiceService;
const running: ChildProcess[] = [];
const clients: Client[] = [];

beforeAll(() => {
  if (!existsSync(MAIN_ENTRY)) {
    throw new Error(`${MAIN_ENTRY} yok: once "pnpm build" (CI'da entegrasyondan once kosar)`);
  }
});

afterEach(async () => {
  for (const client of clients.splice(0)) client.close();
  await Promise.all(
    running.splice(0).map(
      (child) =>
        new Promise<void>((resolve) => {
          if (child.exitCode !== null || child.signalCode !== null) {
            resolve();
            return;
          }
          child.once('exit', () => resolve());
          child.kill('SIGTERM');
        }),
    ),
  );
});

function isFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = createServer();
    probe.once('error', () => resolve(false));
    probe.listen(port, LOCALHOST, () => probe.close(() => resolve(true)));
  });
}

/** gRPC portu ve metrik portu (port + 1000) bos olan bir port. */
async function freePort(): Promise<number> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const port = PORT_MIN + Math.floor(Math.random() * PORT_SPAN);
    if ((await isFree(port)) && (await isFree(port + METRICS_PORT_OFFSET))) return port;
  }
  throw new Error('bos port bulunamadi');
}

interface Started {
  readonly ready: boolean;
  readonly code: number | null;
  readonly output: string;
  readonly port: number;
}

/** Servisi verilen hizla acar; "hazir" satirini ya da cikisi bekler. */
async function startCourier(speed: string | undefined): Promise<Started> {
  const port = await freePort();
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    MOCK: 'true',
    NODE_ENV: 'development',
    LOG_LEVEL: 'info',
    COURIER_GRPC_PORT: String(port),
  };
  delete env['COURIER_SPEED_KMH'];
  delete env['OTEL_EXPORTER_OTLP_ENDPOINT'];
  if (speed !== undefined) env['COURIER_SPEED_KMH'] = speed;
  const child = spawn(process.execPath, [MAIN_ENTRY], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  running.push(child);
  let output = '';
  return new Promise((resolve) => {
    const timer = setTimeout(() => finish(false), START_TIMEOUT_MS);
    const collect = (chunk: Buffer): void => {
      output += chunk.toString('utf8');
      if (output.includes(`"msg":"${READY_MESSAGE}"`)) finish(true);
    };
    const onExit = (): void => finish(false);
    function finish(ready: boolean): void {
      clearTimeout(timer);
      child.stdout?.off('data', collect);
      child.stderr?.off('data', collect);
      child.off('exit', onExit);
      resolve({ ready, code: child.exitCode, output, port });
    }
    child.stdout?.on('data', collect);
    child.stderr?.on('data', collect);
    child.once('exit', onExit);
  });
}

/** Cikmis surecin cikis kodunu bekler (fatal satirindan sonra exit gelir). */
function exitCodeOf(child: ChildProcess | undefined): Promise<number | null> {
  if (child === undefined) return Promise.resolve(null);
  if (child.exitCode !== null) return Promise.resolve(child.exitCode);
  return new Promise((resolve) => child.once('exit', (code) => resolve(code)));
}

const fatalLineSchema = z.object({ level: z.literal('fatal'), issues: z.unknown() }).passthrough();

function fatalLine(output: string): z.infer<typeof fatalLineSchema> | undefined {
  for (const line of output.split('\n')) {
    if (!line.trim().startsWith('{')) continue;
    const parsed = fatalLineSchema.safeParse(JSON.parse(line));
    if (parsed.success) return parsed.data;
  }
  return undefined;
}

/** Demo marketi icin atama ve rotasi: ETA ve rotanin mesafesi. */
async function assignedRoute(port: number): Promise<{ eta: number; distance: number }> {
  const client = new Client(`${LOCALHOST}:${port}`, credentials.createInsecure());
  clients.push(client);
  const order = newId(ID_PREFIX.ORDER);
  const assigned = await unaryCall(
    client,
    service.assignCourier,
    courierV1.AssignCourierRequest.fromPartial({
      orderId: order,
      marketId: MARKET,
      deliveryLocation: DELIVERY,
    }),
  );
  const courierId = assigned.response?.courier?.id ?? '';
  const started = await unaryCall(
    client,
    service.startRoute,
    courierV1.StartRouteRequest.fromPartial({ orderId: order, courierId }),
  );
  if (assigned.error !== undefined || started.error !== undefined) {
    throw new Error(`atama ya da rota basarisiz: ${String(assigned.error ?? started.error)}`);
  }
  return {
    eta: assigned.response?.etaSeconds ?? -1,
    distance: started.response?.route?.distanceMeters ?? -1,
  };
}

const etaAt = (distance: number, speed: number): number =>
  Math.ceil((distance * 3_600) / (speed * 1_000));

describe('QA COURIER_SPEED_KMH gercek acilista (#124, Q6)', () => {
  it.each([
    ['1', '1', 1],
    ['(verilmedi)', undefined, DEFAULT_COURIER_SPEED_KMH],
    ['120', '120', 120],
  ])('COURIER_SPEED_KMH=%s: servis acilir, ETA o hizla', async (_label, value, speed) => {
    const started = await startCourier(value);
    if (!started.ready)
      throw new Error(`servis acilmadi (cikis ${started.code}): ${started.output}`);

    const route = await assignedRoute(started.port);

    expect(route.distance).toBeGreaterThan(0);
    expect(route.eta).toBe(etaAt(route.distance, speed));
  });

  it.each(['0', '121', '20.5', 'abc'])(
    'COURIER_SPEED_KMH=%s: servis ACILMAZ, cikis 1, tek fatal satiri hizi adlandirir',
    async (value) => {
      const started = await startCourier(value);
      const code = await exitCodeOf(running.at(-1));
      const fatal = fatalLine(started.output);

      expect(started.ready).toBe(false);
      expect(code).toBe(1);
      expect(fatal).toBeDefined();
      expect(JSON.stringify(fatal?.issues)).toContain('COURIER_SPEED_KMH');
      expect(started.output).not.toContain(READY_MESSAGE);
    },
  );
});
