import { loadEnv } from '@getir/core';
import { describe, expect, it } from 'vitest';

import { mongoEnvSchema } from '../../src/env.js';

const URI = 'mongodb://localhost:27017/getir?directConnection=true';

describe('mongoEnvSchema', () => {
  it('MONGO_URI zorunludur', () => {
    expect(() => loadEnv(mongoEnvSchema, {})).toThrow(/MONGO_URI/);
  });

  it('veritabani adi icin varsayilan vardir', () => {
    expect(loadEnv(mongoEnvSchema, { MONGO_URI: URI })).toEqual({
      MONGO_URI: URI,
      MONGO_DB: 'getir',
      MONGO_SERVER_SELECTION_TIMEOUT_MS: 5000,
    });
  });

  it('verilen degerleri okur', () => {
    const env = loadEnv(mongoEnvSchema, {
      MONGO_URI: URI,
      MONGO_DB: 'getir_test',
      MONGO_SERVER_SELECTION_TIMEOUT_MS: '1500',
    });

    expect(env.MONGO_DB).toBe('getir_test');
    expect(env.MONGO_SERVER_SELECTION_TIMEOUT_MS).toBe(1500);
  });
});
