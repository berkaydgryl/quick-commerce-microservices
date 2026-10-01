import { loadEnv } from '@getir/core';
import { describe, expect, it } from 'vitest';

import { mongoEnvSchemaFor } from '../../src/env.js';

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
    });
  });

  it('verilen degerleri okur; zaman asimi servisler arasinda ortak', () => {
    expect(
      loadEnv(catalog, {
        CATALOG_MONGO_URI: URI,
        CATALOG_MONGO_DB: 'getir_catalog_test',
        MONGO_SERVER_SELECTION_TIMEOUT_MS: '1500',
      }),
    ).toEqual({ uri: URI, dbName: 'getir_catalog_test', serverSelectionTimeoutMs: 1500 });
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
});
