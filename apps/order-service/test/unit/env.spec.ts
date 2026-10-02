/**
 * Ortamin Mongo parcasi (#51): servis islem suresiyle (MONGO_OPERATION_TIMEOUT_MS)
 * baglanir; seed ve goc komutu suresiz (toplu yazim sureye takilip yarim kalmasin).
 */

import { NO_OPERATION_TIMEOUT } from '@getir/mongo-kit';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { loadSeedEnv, loadServiceEnv } from '../../src/config/env.js';

const URI = 'mongodb://order:parola@localhost:27017/?directConnection=true&authSource=admin';

afterEach(() => {
  vi.unstubAllEnvs();
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
