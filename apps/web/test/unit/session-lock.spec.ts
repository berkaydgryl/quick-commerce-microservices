import { describe, expect, it } from 'vitest';

import { createSessionLock, SESSION_LOCK_NAME } from '../../src/shared/session/session-lock';

import { deferred, fakeLockManager } from './session-test-support';

describe('oturum kilidi (T8.5)', () => {
  it('Web Locks varsa isi oturum kilidinin adiyla ister ve sonucunu dondurur', async () => {
    const { manager, names } = fakeLockManager();
    const lock = createSessionLock(manager);

    await expect(lock(() => Promise.resolve('sonuc'))).resolves.toBe('sonuc');
    expect(names).toEqual([SESSION_LOCK_NAME]);
  });

  it('Web Locks yoksa sekme icinde sirayla calisir: ikinci is birincinin bitmesini bekler', async () => {
    const lock = createSessionLock(undefined);
    const first = deferred<string>();
    const events: string[] = [];

    const a = lock(async () => {
      events.push('a basladi');
      const value = await first.promise;
      events.push('a bitti');
      return value;
    });
    const b = lock(() => {
      events.push('b basladi');
      return Promise.resolve('b');
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(events).toEqual(['a basladi']);

    first.resolve('a');

    await expect(a).resolves.toBe('a');
    await expect(b).resolves.toBe('b');
    expect(events).toEqual(['a basladi', 'a bitti', 'b basladi']);
  });

  it('hata sirayi kilitlemez: onceki is dusse de sonraki calisir', async () => {
    const lock = createSessionLock(undefined);

    const failed = lock(() => Promise.reject(new Error('ag')));
    const next = lock(() => Promise.resolve('devam'));

    await expect(failed).rejects.toThrow('ag');
    await expect(next).resolves.toBe('devam');
  });
});
