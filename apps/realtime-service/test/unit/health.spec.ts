import { createServer } from 'node:http';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { afterEach, describe, expect, it } from 'vitest';

import { createHealthHandler } from '../../src/interfaces/http/health.js';

let server: Server | undefined;
let ready = true;

async function start(): Promise<string> {
  server = createServer(createHealthHandler({ isReady: () => ready }));
  await new Promise<void>((resolve) => server?.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${(server?.address() as AddressInfo).port}`;
}

afterEach(async () => {
  ready = true;
  await new Promise<void>((resolve) => {
    if (server === undefined) {
      resolve();
      return;
    }
    server.close(() => {
      resolve();
    });
  });
  server = undefined;
});

describe('GET /healthz', () => {
  it('hazirken 200 SERVING', async () => {
    const base = await start();

    const response = await fetch(`${base}/healthz`);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: 'SERVING' });
  });

  it('hazir degilken (Redis yok ya da kapanis) 503 NOT_SERVING (QA 03b)', async () => {
    const base = await start();
    ready = false;

    const response = await fetch(`${base}/healthz?ayrinti=1`);

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ status: 'NOT_SERVING' });
  });

  it('baska fiile 405 ve Allow: GET', async () => {
    const base = await start();

    const response = await fetch(`${base}/healthz`, { method: 'POST' });

    expect(response.status).toBe(405);
    expect(response.headers.get('allow')).toBe('GET');
  });

  it('baska yola 404', async () => {
    const base = await start();

    expect((await fetch(`${base}/`)).status).toBe(404);
    expect((await fetch(`${base}/metrics`)).status).toBe(404);
  });
});
