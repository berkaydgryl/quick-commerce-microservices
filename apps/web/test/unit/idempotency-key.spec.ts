import { describe, expect, it } from 'vitest';

import { createIdempotencyKey, isValidIdempotencyKey } from '../../src/shared/api/idempotency-key';

describe('idempotency-key', () => {
  it('sozlesmenin kabul ettigi uzunlukta UUID uretir', () => {
    const key = createIdempotencyKey();
    expect(key).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(isValidIdempotencyKey(key)).toBe(true);
  });

  it('her cagrida farkli anahtar uretir', () => {
    expect(createIdempotencyKey()).not.toBe(createIdempotencyKey());
  });

  it('cok kisa ve cok uzun anahtari reddeder', () => {
    expect(isValidIdempotencyKey('kisa')).toBe(false);
    expect(isValidIdempotencyKey('x'.repeat(129))).toBe(false);
  });
});
