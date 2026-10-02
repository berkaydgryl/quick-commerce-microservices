import { describe, expect, it } from 'vitest';

import {
  createIdempotencyKey,
  createIntentKeys,
  isValidIdempotencyKey,
} from '../../src/shared/api/idempotency-key';

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
    expect(isValidIdempotencyKey('x'.repeat(128))).toBe(true);
  });

  it('harf, rakam, - ve _ disindaki karakteri reddeder (Redis anahtar ayiricilari dahil)', () => {
    expect(isValidIdempotencyKey('kayit_anahtari-01')).toBe(true);
    expect(isValidIdempotencyKey('iki:nokta-anahtar')).toBe(false);
    expect(isValidIdempotencyKey('{usr_1}-anahtar')).toBe(false);
    expect(isValidIdempotencyKey('bosluklu anahtar')).toBe(false);
  });
});

describe('createIntentKeys (T11.8: formun niyet anahtari)', () => {
  const sequence = () => {
    let next = 0;
    return () => `anahtar-${String(++next).padStart(4, '0')}`;
  };

  it('ayni govdenin tekrari ayni anahtarla gider (ikinci kayit yazilmaz)', () => {
    const keyFor = createIntentKeys(sequence());

    expect(keyFor({ title: 'Ev', line: 'Moda' })).toBe('anahtar-0001');
    expect(keyFor({ title: 'Ev', line: 'Moda' })).toBe('anahtar-0001');
  });

  it('duzeltilmis govde YENI anahtar alir (ayni anahtar + farkli govde 409 CONFLICT olurdu)', () => {
    const keyFor = createIntentKeys(sequence());
    keyFor({ title: 'Ev', line: 'Moda' });

    expect(keyFor({ title: 'Annem', line: 'Moda' })).toBe('anahtar-0002');
    // Yalnizca SON govde hatirlanir: eskiye donmek yeni niyettir.
    expect(keyFor({ title: 'Ev', line: 'Moda' })).toBe('anahtar-0003');
  });

  it('varsayilan uretec sozlesmeye uygun anahtar verir', () => {
    expect(isValidIdempotencyKey(createIntentKeys()({ title: 'Ev' }))).toBe(true);
  });
});
