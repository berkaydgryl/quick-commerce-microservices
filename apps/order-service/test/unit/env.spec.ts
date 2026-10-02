/**
 * Ortamin Mongo parcasi (#51): servis islem suresiyle (MONGO_OPERATION_TIMEOUT_MS)
 * baglanir; seed ve goc komutu suresiz (toplu yazim sureye takilip yarim kalmasin).
 * Stok kilidi (T11.2): inventory adresi ve kilit omru, inventory'nin sinirlariyla.
 */

import { NO_OPERATION_TIMEOUT } from '@getir/mongo-kit';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { loadSeedEnv, loadServiceEnv } from '../../src/config/env.js';

const URI = 'mongodb://order:parola@localhost:27017/?directConnection=true&authSource=admin';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('order ortami: Mongo islem suresi (#51)', () => {
  it('servis MONGO_OPERATION_TIMEOUT_MS ile baglanir; seed ve goc komutu suresiz', () => {
    vi.stubEnv('MOCK', 'false');
    vi.stubEnv('ORDER_MONGO_URI', URI);
    vi.stubEnv('REDIS_URL', 'redis://localhost:6379');
    vi.stubEnv('MONGO_OPERATION_TIMEOUT_MS', '750');

    expect(loadServiceEnv().mongo?.operationTimeoutMs).toBe(750);
    expect(loadSeedEnv().mongo.operationTimeoutMs).toBe(NO_OPERATION_TIMEOUT);
  });
});

describe('order ortami: stok kilidi (T11.2)', () => {
  it('verilmezse yerel inventory ve 10 dk kilit', () => {
    vi.stubEnv('MOCK', 'true');

    expect(loadServiceEnv()).toMatchObject({
      INVENTORY_GRPC_ADDR: 'localhost:50052',
      RESERVATION_TTL_SECONDS: 600,
    });
  });

  it('verilen adres ve omur okunur', () => {
    vi.stubEnv('MOCK', 'true');
    vi.stubEnv('INVENTORY_GRPC_ADDR', 'inventory-service:50052');
    vi.stubEnv('RESERVATION_TTL_SECONDS', '120');

    expect(loadServiceEnv()).toMatchObject({
      INVENTORY_GRPC_ADDR: 'inventory-service:50052',
      RESERVATION_TTL_SECONDS: 120,
    });
  });

  it.each(['29', '901', 'on'])(
    "inventory'nin kabul etmeyecegi omur (%s) acilista reddedilir",
    (ttl) => {
      vi.stubEnv('MOCK', 'true');
      vi.stubEnv('RESERVATION_TTL_SECONDS', ttl);
      // Acilis hatasi tek satir JSON yazip process'i kapatir; test ikisini de yakalar.
      const exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
      const written: string[] = [];
      vi.spyOn(process.stderr, 'write').mockImplementation((chunk: string | Uint8Array) => {
        written.push(String(chunk));
        return true;
      });

      expect(() => loadServiceEnv()).toThrow();
      expect(exit).toHaveBeenCalledWith(1);
      expect(written.join('')).toContain('RESERVATION_TTL_SECONDS');
    },
  );
});
