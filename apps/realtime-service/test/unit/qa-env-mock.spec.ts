/**
 * QA kara kutu (T12.3, D10): MOCK=true'da olay dinleme kapali. main.ts dinlemeyi
 * yalnizca `env.redis` tanimliyken kurar; burada MOCK=true iken REDIS_URL dolu
 * olsa bile (ornegin .env'den gelmis) Redis ayarinin tanimsiz kaldigi denenir.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import { loadServiceEnv } from '../../src/config/env.js';
import { TEST_SECRET } from '../support/tokens.js';

const REDIS_URL = 'redis://127.0.0.1:6390';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('QA-RT3-12: MOCK ve olay dinleme', () => {
  it('MOCK=true iken REDIS_URL verilmis olsa da Redis ayari tanimsiz (dinleme kapali)', () => {
    vi.stubEnv('MOCK', 'true');
    vi.stubEnv('REDIS_URL', REDIS_URL);
    vi.stubEnv('REALTIME_TOKEN_SECRET', '');

    expect(loadServiceEnv().redis).toBeUndefined();
  });

  it('kontrol: MOCK=false iken ayni REDIS_URL ile Redis ayari tanimli (dinleme acik)', () => {
    vi.stubEnv('MOCK', 'false');
    vi.stubEnv('REDIS_URL', REDIS_URL);
    vi.stubEnv('REALTIME_TOKEN_SECRET', TEST_SECRET);

    expect(loadServiceEnv().redis).toMatchObject({ REDIS_URL });
  });
});
