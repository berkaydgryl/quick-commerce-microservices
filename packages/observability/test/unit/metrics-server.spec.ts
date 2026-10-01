/**
 * HTTP /metrics ucu (T10.5): yalnizca GET /metrics, kapanis idempotent ve
 * askidaki baglanti kapanisi kilitlemez. Gercek soket, yalnizca 127.0.0.1.
 */

import { createServer } from 'node:http';
import { connect } from 'node:net';
import type { AddressInfo } from 'node:net';

import { Gauge, Registry } from '@prometheus-io/client';
import { afterEach, describe, expect, it } from 'vitest';

import { counter, metricsRegistry } from '../../src/metrics/registry.js';
import { METRICS_CLOSE_GRACE_MS, startMetricsServer } from '../../src/metrics/server.js';
import type { MetricsServer } from '../../src/metrics/server.js';

const HOST = '127.0.0.1';

const opened: MetricsServer[] = [];

afterEach(async () => {
  await Promise.all(opened.splice(0).map((server) => server.close()));
});

async function open(registry?: Registry): Promise<MetricsServer> {
  const server = await startMetricsServer({
    host: HOST,
    port: 0,
    ...(registry === undefined ? {} : { registry }),
  });
  opened.push(server);
  return server;
}

function url(server: MetricsServer, path: string): string {
  return `http://${HOST}:${server.port}${path}`;
}

describe('startMetricsServer', () => {
  it('GET /metrics surecin defterini Prometheus metin bicimiyle doner', async () => {
    counter({ name: 'deneme_uc_total', help: 'h' }).inc();
    const server = await open();

    const response = await fetch(url(server, '/metrics'));

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe(metricsRegistry.contentType);
    expect(await response.text()).toMatch(/^deneme_uc_total(\{[^}]*\})? 1$/m);
  });

  it('sorgu dizesi yolu degistirmez', async () => {
    const server = await open();

    expect((await fetch(url(server, '/metrics?debug=1'))).status).toBe(200);
  });

  it.each(['/', '/metrics/', '/health', '/metricsx'])('baska yol (%s) 404', async (path) => {
    const server = await open();

    expect((await fetch(url(server, path))).status).toBe(404);
  });

  it.each(['POST', 'PUT', 'DELETE'])('/metrics icin %s 405 ve Allow: GET', async (method) => {
    const server = await open();

    const response = await fetch(url(server, '/metrics'), { method });

    expect(response.status).toBe(405);
    expect(response.headers.get('allow')).toBe('GET');
  });

  it('metrik toplanamazsa 500 doner, sunucu ayakta kalir', async () => {
    // Toplarken hata veren gosterge (orn. dis kaynagi okuyan collect).
    const registry = new Registry();
    new Gauge({
      name: 'deneme_bozuk_collect',
      help: 'h',
      registers: [registry],
      collect: () => {
        throw new Error('kaynak okunamadi');
      },
    });
    const server = await open(registry);

    expect((await fetch(url(server, '/metrics'))).status).toBe(500);
    expect((await fetch(url(server, '/yok'))).status).toBe(404);
  });

  it('dolu porta acilamaz: dinleme hatasiyla reddedilir', async () => {
    const busy = createServer();
    await new Promise<void>((resolve) => busy.listen(0, HOST, resolve));
    const { port } = busy.address() as AddressInfo;
    try {
      await expect(startMetricsServer({ host: HOST, port })).rejects.toMatchObject({
        code: 'EADDRINUSE',
      });
    } finally {
      await new Promise((resolve) => busy.close(resolve));
    }
  });
});

describe('MetricsServer.close', () => {
  it('kapanistan sonra port baglanti kabul etmez; ikinci cagri da biter', async () => {
    const server = await open();
    expect((await fetch(url(server, '/metrics'))).status).toBe(200);

    await server.close();
    await server.close();

    await expect(fetch(url(server, '/metrics'))).rejects.toMatchObject({
      cause: { code: 'ECONNREFUSED' },
    });
  });

  it('acik keep-alive baglantisi kapanisi bekletmez', async () => {
    const server = await open();
    const agentResponse = await fetch(url(server, '/metrics'), {
      headers: { connection: 'keep-alive' },
    });
    await agentResponse.text();

    const startedAt = Date.now();
    await server.close();

    expect(Date.now() - startedAt).toBeLessThan(METRICS_CLOSE_GRACE_MS);
  });

  it('basliklari bitmemis istekle bekleyen istemci kapanisi kilitlemez', async () => {
    const server = await open();
    // Yarim istek: son bos satir gelmedigi icin sunucu cevap veremez, baglanti asili.
    const socket = connect(server.port, HOST);
    socket.on('error', () => undefined);
    await new Promise<void>((resolve) => socket.once('connect', resolve));
    socket.write('GET /metrics HTTP/1.1\r\nHost: deneme\r\n');
    await new Promise((resolve) => setTimeout(resolve, 50));

    const startedAt = Date.now();
    await server.close();
    const elapsed = Date.now() - startedAt;

    socket.destroy();
    // Node'un baslik suresi (60 sn) beklenmez; en gec bekleme payi kadar.
    expect(elapsed).toBeLessThan(METRICS_CLOSE_GRACE_MS * 3);
  });
});
