/**
 * Kurye servisinin ortami: MOCK=true -> bellek (Mongo ve Redis istenmez),
 * MOCK=false -> COURIER_MONGO_URI (D14) ve REDIS_URL (T13.3) zorunlu. Seed ve
 * goc komutu MOCK'tan bagimsiz Mongo ister ve suresizdir (#51); servis islem
 * suresiyle baglanir.
 */

import { NO_OPERATION_TIMEOUT } from '@getir/mongo-kit';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  DEFAULT_COURIER_SPEED_KMH,
  DEFAULT_COURIER_TICK_MS,
  DEFAULT_MONGO_DB,
  DEFAULT_ORDER_PREP_SECONDS,
} from '../../src/config/constants.js';
import { loadCommandEnv, loadHealthcheckEnv, loadServiceEnv } from '../../src/config/env.js';

const URI = 'mongodb://courier:parola@localhost:27017/?directConnection=true&authSource=admin';
const REDIS_URL = 'redis://localhost:6379';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

/** Acilis hatasi tek satir JSON yazip process'i kapatir; test ikisini de yakalar. */
function captureExit() {
  const exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
  const written: string[] = [];
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk: string | Uint8Array) => {
    written.push(String(chunk));
    return true;
  });
  vi.spyOn(process.stderr, 'write').mockImplementation((chunk: string | Uint8Array) => {
    written.push(String(chunk));
    return true;
  });
  return { exit, written };
}

describe('kurye ortami: depo secimi (MOCK)', () => {
  it('MOCK=true iken Mongo ve Redis istenmez: adres yoksa da acilir, depo bellek', () => {
    vi.stubEnv('MOCK', 'true');
    vi.stubEnv('COURIER_MONGO_URI', '');
    vi.stubEnv('REDIS_URL', '');

    const env = loadServiceEnv();

    expect(env.mongo).toBeUndefined();
    expect(env.redis).toBeUndefined();
    expect(env.COURIER_GRPC_PORT).toBe(50_056);
  });

  it('MOCK=false iken COURIER_MONGO_URI zorunlu: yoksa acilis durur ve degisken adi yazilir', () => {
    vi.stubEnv('MOCK', 'false');
    vi.stubEnv('COURIER_MONGO_URI', '');
    const { exit, written } = captureExit();

    expect(() => loadServiceEnv()).toThrow();
    expect(exit).toHaveBeenCalledWith(1);
    expect(written.join('')).toContain('COURIER_MONGO_URI');
  });

  it('MOCK=false iken kendi adresi ve veritabani (varsayilan getir_courier), islem suresiyle; Redis adresi', () => {
    vi.stubEnv('MOCK', 'false');
    vi.stubEnv('COURIER_MONGO_URI', URI);
    vi.stubEnv('COURIER_MONGO_DB', '');
    vi.stubEnv('MONGO_OPERATION_TIMEOUT_MS', '750');
    vi.stubEnv('REDIS_URL', REDIS_URL);

    const env = loadServiceEnv();

    expect(env.mongo).toMatchObject({
      uri: URI,
      dbName: DEFAULT_MONGO_DB,
      operationTimeoutMs: 750,
    });
    expect(env.redis?.REDIS_URL).toBe(REDIS_URL);
  });

  it('MOCK=false iken REDIS_URL zorunlu (T13.3 tick): yoksa acilis durur ve degisken adi yazilir', () => {
    vi.stubEnv('MOCK', 'false');
    vi.stubEnv('COURIER_MONGO_URI', URI);
    vi.stubEnv('REDIS_URL', '');
    const { exit, written } = captureExit();

    expect(() => loadServiceEnv()).toThrow();
    expect(exit).toHaveBeenCalledWith(1);
    expect(written.join('')).toContain('REDIS_URL');
  });
});

describe('kurye ortami: tick araligi ve hazirlik suresi (T13.3)', () => {
  it('verilmezse varsayilanlar (2000 ms, 300 sn); verilirse o; hazirlik 0 olabilir', () => {
    vi.stubEnv('MOCK', 'true');
    vi.stubEnv('COURIER_TICK_MS', '');
    vi.stubEnv('ORDER_PREP_SECONDS', '');
    expect(loadServiceEnv()).toMatchObject({
      COURIER_TICK_MS: DEFAULT_COURIER_TICK_MS,
      ORDER_PREP_SECONDS: DEFAULT_ORDER_PREP_SECONDS,
    });

    vi.stubEnv('COURIER_TICK_MS', '500');
    vi.stubEnv('ORDER_PREP_SECONDS', '0');
    expect(loadServiceEnv()).toMatchObject({ COURIER_TICK_MS: 500, ORDER_PREP_SECONDS: 0 });
  });

  it.each([
    ['COURIER_TICK_MS', '199'],
    ['COURIER_TICK_MS', '60001'],
    ['ORDER_PREP_SECONDS', '-1'],
    ['ORDER_PREP_SECONDS', '3601'],
    ['ORDER_PREP_SECONDS', 'yarim'],
  ])('%s="%s" reddedilir: acilis durur, degisken adi yazilir', (name, value) => {
    vi.stubEnv('MOCK', 'true');
    vi.stubEnv(name, value);
    const { exit, written } = captureExit();

    expect(() => loadServiceEnv()).toThrow();
    expect(exit).toHaveBeenCalledWith(1);
    expect(written.join('')).toContain(name);
  });
});

describe('kurye ortami: kurye hizi (COURIER_SPEED_KMH, T13.2)', () => {
  it('verilmezse 20 km/sa; verilirse o (tam sayi)', () => {
    vi.stubEnv('MOCK', 'true');
    vi.stubEnv('COURIER_SPEED_KMH', '');
    expect(loadServiceEnv().COURIER_SPEED_KMH).toBe(DEFAULT_COURIER_SPEED_KMH);

    vi.stubEnv('COURIER_SPEED_KMH', '35');
    expect(loadServiceEnv().COURIER_SPEED_KMH).toBe(35);
  });

  it.each(['0', '121', '12.5', 'hizli'])(
    '"%s" reddedilir: acilis durur, degisken adi yazilir',
    (value) => {
      vi.stubEnv('MOCK', 'true');
      vi.stubEnv('COURIER_SPEED_KMH', value);
      const { exit, written } = captureExit();

      expect(() => loadServiceEnv()).toThrow();
      expect(exit).toHaveBeenCalledWith(1);
      expect(written.join('')).toContain('COURIER_SPEED_KMH');
    },
  );
});

describe('kurye ortami: seed ve goc komutu', () => {
  it('MOCK=true olsa da Mongo ister ve suresizdir', () => {
    vi.stubEnv('MOCK', 'true');
    vi.stubEnv('COURIER_MONGO_URI', URI);
    vi.stubEnv('MONGO_OPERATION_TIMEOUT_MS', '750');

    expect(loadCommandEnv().mongo).toMatchObject({
      uri: URI,
      operationTimeoutMs: NO_OPERATION_TIMEOUT,
    });
  });

  it('MOCK=true olsa da adres yoksa komut durur', () => {
    vi.stubEnv('MOCK', 'true');
    vi.stubEnv('COURIER_MONGO_URI', '');
    const { exit, written } = captureExit();

    expect(() => loadCommandEnv()).toThrow();
    expect(exit).toHaveBeenCalledWith(1);
    expect(written.join('')).toContain('COURIER_MONGO_URI');
  });
});

describe('kurye ortami: saglik yoklamasi', () => {
  it('yalnizca portu okur; Mongo adresi gerekmez', () => {
    vi.stubEnv('COURIER_MONGO_URI', '');
    vi.stubEnv('COURIER_GRPC_PORT', '50206');

    expect(loadHealthcheckEnv()).toEqual({ port: 50_206 });
  });
});
