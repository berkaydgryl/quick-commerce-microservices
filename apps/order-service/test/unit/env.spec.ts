/**
 * Ortamin Mongo parcasi (#51): servis islem suresiyle (MONGO_OPERATION_TIMEOUT_MS)
 * baglanir; seed ve goc komutu suresiz (toplu yazim sureye takilip yarim kalmasin).
 * Stok kilidi (T11.2): inventory adresi ve kilit omru, inventory'nin sinirlariyla.
 * Kurye atama (T13.1 PR 2): courier adresi.
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

describe('order ortami: banda gore kilit ve uzatma (T11.3)', () => {
  it('verilmezse orta risk 2 dk, uzatma 60 sn (.env.example); verilenler okunur', () => {
    vi.stubEnv('MOCK', 'true');
    expect(loadServiceEnv()).toMatchObject({
      RESERVATION_TTL_MEDIUM_RISK_SECONDS: 120,
      RESERVATION_EXTEND_SECONDS: 60,
    });

    vi.stubEnv('RESERVATION_TTL_MEDIUM_RISK_SECONDS', '45');
    vi.stubEnv('RESERVATION_EXTEND_SECONDS', '30');
    expect(loadServiceEnv()).toMatchObject({
      RESERVATION_TTL_MEDIUM_RISK_SECONDS: 45,
      RESERVATION_EXTEND_SECONDS: 30,
    });
  });

  it.each([
    ['RESERVATION_TTL_MEDIUM_RISK_SECONDS', '29'],
    ['RESERVATION_TTL_MEDIUM_RISK_SECONDS', '901'],
    ['RESERVATION_EXTEND_SECONDS', '0'],
    ['RESERVATION_EXTEND_SECONDS', '301'],
  ])("inventory'nin kabul etmeyecegi %s=%s acilista reddedilir", (name, value) => {
    vi.stubEnv('MOCK', 'true');
    vi.stubEnv(name, value);
    const exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    const written: string[] = [];
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk: string | Uint8Array) => {
      written.push(String(chunk));
      return true;
    });

    expect(() => loadServiceEnv()).toThrow();
    expect(exit).toHaveBeenCalledWith(1);
    expect(written.join('')).toContain(name);
  });
});

describe('order ortami: supurucu (T11.2 PR 2)', () => {
  it('verilmezse 10 sn; verilen aralik okunur', () => {
    vi.stubEnv('MOCK', 'true');
    expect(loadServiceEnv().ORDER_SWEEPER_INTERVAL_MS).toBe(10_000);

    vi.stubEnv('ORDER_SWEEPER_INTERVAL_MS', '2500');
    expect(loadServiceEnv().ORDER_SWEEPER_INTERVAL_MS).toBe(2_500);
  });

  it.each(['999', '600001', 'sik'])('aralik disi deger (%s) acilista reddedilir', (value) => {
    vi.stubEnv('MOCK', 'true');
    vi.stubEnv('ORDER_SWEEPER_INTERVAL_MS', value);
    const exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    const written: string[] = [];
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk: string | Uint8Array) => {
      written.push(String(chunk));
      return true;
    });

    expect(() => loadServiceEnv()).toThrow();
    expect(exit).toHaveBeenCalledWith(1);
    expect(written.join('')).toContain('ORDER_SWEEPER_INTERVAL_MS');
  });
});

describe('order ortami: kurye atama (T13.1 PR 2)', () => {
  it('verilmezse yerel courier (50056, .env.example); verilen adres okunur', () => {
    vi.stubEnv('MOCK', 'true');
    expect(loadServiceEnv().COURIER_GRPC_ADDR).toBe('localhost:50056');

    vi.stubEnv('COURIER_GRPC_ADDR', 'courier-service:50056');
    expect(loadServiceEnv().COURIER_GRPC_ADDR).toBe('courier-service:50056');
  });
});
