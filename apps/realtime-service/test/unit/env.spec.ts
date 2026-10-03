import { loadEnv } from '@getir/core';
import { describe, expect, it } from 'vitest';

import { DEFAULT_REALTIME_PORT, EXAMPLE_TOKEN_SECRET } from '../../src/config/constants.js';
import { realtimeEnvSchema, tokenSecretProblem } from '../../src/config/env.js';
import { TEST_SECRET } from '../support/tokens.js';

describe('realtimeEnvSchema', () => {
  it('varsayilanlar: port 3001, sir yok, izler kapali', () => {
    const env = loadEnv(realtimeEnvSchema, { MOCK: 'true' });

    expect(env).toMatchObject({ REALTIME_PORT: DEFAULT_REALTIME_PORT, MOCK: true });
    expect(env.REALTIME_TOKEN_SECRET).toBeUndefined();
    expect(env.OTEL_EXPORTER_OTLP_ENDPOINT).toBeUndefined();
  });

  it('MOCK=false iken sir zorunludur', () => {
    expect(() => loadEnv(realtimeEnvSchema, { MOCK: 'false' })).toThrow(
      /REALTIME_TOKEN_SECRET: zorunlu/,
    );
  });

  it('bos metin sir verilmemis sayilir (compose "X=")', () => {
    expect(() =>
      loadEnv(realtimeEnvSchema, { MOCK: 'false', REALTIME_TOKEN_SECRET: '   ' }),
    ).toThrow(/REALTIME_TOKEN_SECRET: zorunlu/);
  });

  it('gecerli sirri kabul eder', () => {
    const env = loadEnv(realtimeEnvSchema, { MOCK: 'false', REALTIME_TOKEN_SECRET: TEST_SECRET });

    expect(env.REALTIME_TOKEN_SECRET).toBe(TEST_SECRET);
  });

  it('kisa sirri MOCK=true iken de reddeder; mesaj degeri icermez', () => {
    const attempt = (): unknown =>
      loadEnv(realtimeEnvSchema, { MOCK: 'true', REALTIME_TOKEN_SECRET: 'kisa-sir' });

    expect(attempt).toThrow(/en az 32 bayt olmali, verilen 8 bayt/);
    expect(attempt).not.toThrow(/kisa-sir/);
  });

  it.each([
    ['0', 'sifir'],
    ['64536', 'metrik portu 65535 ustune tasar'],
    ['abc', 'sayi degil'],
  ])('gecersiz portu (%s, %s) reddeder', (port) => {
    expect(() => loadEnv(realtimeEnvSchema, { MOCK: 'true', REALTIME_PORT: port })).toThrow(
      /REALTIME_PORT/,
    );
  });
});

describe('tokenSecretProblem', () => {
  const development = { MOCK: false, NODE_ENV: 'development' };
  const production = { MOCK: false, NODE_ENV: 'production' };

  it("ornek sir gelistirmede gecer, production'da reddedilir", () => {
    expect(tokenSecretProblem(EXAMPLE_TOKEN_SECRET, development)).toBeUndefined();
    expect(tokenSecretProblem(EXAMPLE_TOKEN_SECRET, production)).toMatch(/ornek sir/);
  });

  it('MOCK=true iken sir verilmeyebilir (siparis odalari kapali, D3)', () => {
    expect(tokenSecretProblem(undefined, { MOCK: true, NODE_ENV: 'production' })).toBeUndefined();
  });

  it('uzunluk bayt olarak sayilir (cok baytli karakter)', () => {
    // 16 karakter, 32 bayt.
    expect(tokenSecretProblem('ğ'.repeat(16), development)).toBeUndefined();
    expect(tokenSecretProblem('ğ'.repeat(15), development)).toMatch(/verilen 30 bayt/);
  });
});
