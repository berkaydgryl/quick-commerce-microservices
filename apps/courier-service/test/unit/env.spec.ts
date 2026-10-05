/**
 * Kurye servisinin ortami: MOCK=true -> bellek (Mongo istenmez), MOCK=false ->
 * COURIER_MONGO_URI zorunlu (D14). Seed ve goc komutu MOCK'tan bagimsiz Mongo
 * ister ve suresizdir (#51); servis islem suresiyle baglanir.
 */

import { NO_OPERATION_TIMEOUT } from '@getir/mongo-kit';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_COURIER_SPEED_KMH, DEFAULT_MONGO_DB } from '../../src/config/constants.js';
import { loadCommandEnv, loadHealthcheckEnv, loadServiceEnv } from '../../src/config/env.js';

const URI = 'mongodb://courier:parola@localhost:27017/?directConnection=true&authSource=admin';

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
  it('MOCK=true iken Mongo istenmez: adres yoksa da acilir, depo bellek', () => {
    vi.stubEnv('MOCK', 'true');
    vi.stubEnv('COURIER_MONGO_URI', '');

    const env = loadServiceEnv();

    expect(env.mongo).toBeUndefined();
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

  it('MOCK=false iken kendi adresi ve veritabani (varsayilan getir_courier), islem suresiyle', () => {
    vi.stubEnv('MOCK', 'false');
    vi.stubEnv('COURIER_MONGO_URI', URI);
    vi.stubEnv('COURIER_MONGO_DB', '');
    vi.stubEnv('MONGO_OPERATION_TIMEOUT_MS', '750');

    expect(loadServiceEnv().mongo).toMatchObject({
      uri: URI,
      dbName: DEFAULT_MONGO_DB,
      operationTimeoutMs: 750,
    });
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
