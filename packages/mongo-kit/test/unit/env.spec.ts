import { loadEnv } from '@getir/core';
import { describe, expect, it } from 'vitest';

import { NO_OPERATION_TIMEOUT } from '../../src/client.js';
import { mongoEnvSchemaFor, withoutOperationTimeout } from '../../src/env.js';

const URI = 'mongodb://catalog:parola@localhost:27017/?directConnection=true&authSource=admin';
const catalog = mongoEnvSchemaFor({ prefix: 'CATALOG', defaultDb: 'getir_catalog' });

describe('mongoEnvSchemaFor (servis basina Mongo, D14)', () => {
  it('servisin adresi zorunlu; hatada degiskenin ADI gorunur', () => {
    expect(() => loadEnv(catalog, {})).toThrow(/CATALOG_MONGO_URI/);
  });

  it('veritabani verilmezse servisin varsayilani; deger connectMongo bicimine cevrilir', () => {
    expect(loadEnv(catalog, { CATALOG_MONGO_URI: URI })).toEqual({
      uri: URI,
      dbName: 'getir_catalog',
      serverSelectionTimeoutMs: 5000,
      operationTimeoutMs: 2000,
    });
  });

  it('verilen degerleri okur; zaman asimi servisler arasinda ortak', () => {
    expect(
      loadEnv(catalog, {
        CATALOG_MONGO_URI: URI,
        CATALOG_MONGO_DB: 'getir_catalog_test',
        MONGO_SERVER_SELECTION_TIMEOUT_MS: '1500',
        MONGO_OPERATION_TIMEOUT_MS: '750',
      }),
    ).toEqual({
      uri: URI,
      dbName: 'getir_catalog_test',
      serverSelectionTimeoutMs: 1500,
      operationTimeoutMs: 750,
    });
  });

  it('baska servisin ya da eski ortak degiskenlerin degeri OKUNMAZ', () => {
    // Butun servisler ayni .env'i okur: catalog, order'in adresine ya da D14
    // oncesi ortak MONGO_URI'ye sessizce baglanmamali.
    expect(() =>
      loadEnv(catalog, {
        ORDER_MONGO_URI: URI,
        MONGO_URI: 'mongodb://localhost:27017/getir',
        MONGO_DB: 'getir',
      }),
    ).toThrow(/CATALOG_MONGO_URI/);
  });

  it('islem suresi 100-60000 ms arasinda; disi acilisi durdurur, hatada ADI gorunur (#51)', () => {
    for (const value of ['99', '60001', '0', 'iki']) {
      expect(() =>
        loadEnv(catalog, { CATALOG_MONGO_URI: URI, MONGO_OPERATION_TIMEOUT_MS: value }),
      ).toThrow(/MONGO_OPERATION_TIMEOUT_MS/);
    }
    for (const [value, expected] of [
      ['100', 100],
      ['60000', 60_000],
    ] as const) {
      expect(
        loadEnv(catalog, { CATALOG_MONGO_URI: URI, MONGO_OPERATION_TIMEOUT_MS: value })
          .operationTimeoutMs,
      ).toBe(expected);
    }
  });

  it('withoutOperationTimeout yalnizca sureyi kaldirir (seed ve reseed, #51)', () => {
    const env = loadEnv(catalog, { CATALOG_MONGO_URI: URI, MONGO_OPERATION_TIMEOUT_MS: '750' });

    expect(withoutOperationTimeout(env)).toEqual({
      ...env,
      operationTimeoutMs: NO_OPERATION_TIMEOUT,
    });
    expect(env.operationTimeoutMs).toBe(750);
  });
});
