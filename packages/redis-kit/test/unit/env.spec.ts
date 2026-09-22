import { loadEnv } from '@getir/core';
import { describe, expect, it } from 'vitest';

import { redisEnvSchema } from '../../src/env.js';

const URL = 'redis://localhost:6379';

describe('redisEnvSchema', () => {
  it('REDIS_URL zorunludur', () => {
    expect(() => loadEnv(redisEnvSchema, {})).toThrow(/REDIS_URL/);
    // Bos metin de "yok" sayilir: docker-compose'da "REDIS_URL=" boyle gelir.
    expect(() => loadEnv(redisEnvSchema, { REDIS_URL: '  ' })).toThrow(/REDIS_URL/);
  });

  it('varsayilan zaman asimini uygular', () => {
    expect(loadEnv(redisEnvSchema, { REDIS_URL: URL })).toEqual({
      REDIS_URL: URL,
      REDIS_CONNECT_TIMEOUT_MS: 5000,
    });
  });

  it('gecersiz zaman asimini reddeder', () => {
    expect(() =>
      loadEnv(redisEnvSchema, { REDIS_URL: URL, REDIS_CONNECT_TIMEOUT_MS: '0' }),
    ).toThrow(/REDIS_CONNECT_TIMEOUT_MS/);
  });
});
