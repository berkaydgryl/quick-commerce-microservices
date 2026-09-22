import { loadEnv } from '@getir/core';
import { describe, expect, it } from 'vitest';

import { DEFAULT_GRPC_HOST, DEFAULT_SHUTDOWN_TIMEOUT_MS } from '../../src/config/constants.js';
import { grpcPort, serviceEnvSchema } from '../../src/config/env.js';

const CATALOG_DEFAULT_PORT = 50_051;

const schema = serviceEnvSchema.extend({
  CATALOG_GRPC_PORT: grpcPort(CATALOG_DEFAULT_PORT),
});

describe('serviceEnvSchema', () => {
  it('bos ortamda guvenli varsayilanlarla acilir', () => {
    const env = loadEnv(schema, {});

    expect(env.GRPC_HOST).toBe(DEFAULT_GRPC_HOST);
    expect(env.GRPC_SHUTDOWN_TIMEOUT_MS).toBe(DEFAULT_SHUTDOWN_TIMEOUT_MS);
    expect(env.CATALOG_GRPC_PORT).toBe(CATALOG_DEFAULT_PORT);
    // Ortak semadan gelenler de yerinde duruyor.
    expect(env.NODE_ENV).toBe('development');
    expect(env.MOCK).toBe(false);
  });

  it('verilen degerleri okur', () => {
    const env = loadEnv(schema, {
      GRPC_HOST: '127.0.0.1',
      GRPC_SHUTDOWN_TIMEOUT_MS: '250',
      CATALOG_GRPC_PORT: '50052',
      LOG_LEVEL: 'debug',
    });

    expect(env.GRPC_HOST).toBe('127.0.0.1');
    expect(env.GRPC_SHUTDOWN_TIMEOUT_MS).toBe(250);
    expect(env.CATALOG_GRPC_PORT).toBe(50_052);
    expect(env.LOG_LEVEL).toBe('debug');
  });

  it('bos metin tanimsiz sayilir; varsayilan uygulanir', () => {
    // docker-compose "GRPC_HOST=" yazildiginda degisken bos string olarak gelir.
    expect(loadEnv(schema, { GRPC_HOST: '   ' }).GRPC_HOST).toBe(DEFAULT_GRPC_HOST);
  });

  it('gecersiz portta process baslangicta duser', () => {
    expect(() => loadEnv(schema, { CATALOG_GRPC_PORT: '70000' })).toThrow(/CATALOG_GRPC_PORT/);
    expect(() => loadEnv(schema, { CATALOG_GRPC_PORT: 'elli-bir' })).toThrow(/tam sayi/);
  });

  it('gecersiz kapanis suresini reddeder', () => {
    expect(() => loadEnv(schema, { GRPC_SHUTDOWN_TIMEOUT_MS: '-1' })).toThrow(
      /GRPC_SHUTDOWN_TIMEOUT_MS/,
    );
  });
});
