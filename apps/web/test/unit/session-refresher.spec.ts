import type { AuthSession } from '@getir/contracts';
import { AppError, ERROR_CODES } from '@getir/core';
import { describe, expect, it, vi } from 'vitest';

import { createSessionLock } from '../../src/shared/session/session-lock';
import type { SessionLock } from '../../src/shared/session/session-lock';
import { createSessionRefresher } from '../../src/shared/session/session-refresher';
import { createSessionStore } from '../../src/shared/session/session-store';

import { deferred, fakeLockManager, sessionWith } from './session-test-support';

function refresherWith(refresh: () => Promise<AuthSession>, lock: SessionLock = (task) => task()) {
  const store = createSessionStore();
  const refresher = createSessionRefresher({ refresh, session: store.getState(), lock });
  return { store, refresher };
}

describe('sessiz yenileme (T8.5)', () => {
  it('basarili yenileme oturumu acar ve yeni jetonu dondurur', async () => {
    const { store, refresher } = refresherWith(() => Promise.resolve(sessionWith('yeni')));

    await expect(refresher.refresh()).resolves.toBe('yeni');
    expect(store.getState()).toMatchObject({ status: 'authenticated', accessToken: 'yeni' });
  });

  it('401 oturumu kapatir ve null dondurur (cerez yok, gecersiz ya da iptal)', async () => {
    const { store, refresher } = refresherWith(() =>
      Promise.reject(new AppError(ERROR_CODES.UNAUTHORIZED, 'x')),
    );
    store.getState().signIn(sessionWith('eski'));

    await expect(refresher.refresh()).resolves.toBeNull();
    expect(store.getState()).toMatchObject({ status: 'anonymous', accessToken: null });
  });

  it('gecici hata firlatilir ve oturum yerinde kalir: oturum bitmedi', async () => {
    const outage = new AppError(ERROR_CODES.SERVICE_UNAVAILABLE, 'x');
    const { store, refresher } = refresherWith(() => Promise.reject(outage));
    store.getState().signIn(sessionWith('eski'));

    await expect(refresher.refresh()).rejects.toBe(outage);
    expect(store.getState()).toMatchObject({ status: 'authenticated', accessToken: 'eski' });
  });

  it('tek ucus: ayni anda gelen uc cagri tek yenileme bekler', async () => {
    const pending = deferred<AuthSession>();
    const refresh = vi.fn(() => pending.promise);
    const { refresher } = refresherWith(refresh);

    const calls = [refresher.refresh(), refresher.refresh(), refresher.refresh()];
    pending.resolve(sessionWith('ortak'));

    await expect(Promise.all(calls)).resolves.toEqual(['ortak', 'ortak', 'ortak']);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('biten yenilemeden sonra yeni cagri yeniden yeniler', async () => {
    const refresh = vi
      .fn<() => Promise<AuthSession>>()
      .mockResolvedValueOnce(sessionWith('bir'))
      .mockResolvedValueOnce(sessionWith('iki'));
    const { refresher } = refresherWith(refresh);

    await expect(refresher.refresh()).resolves.toBe('bir');
    await expect(refresher.refresh()).resolves.toBe('iki');
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it('yenileme oturum kilidinin icinde calisir', async () => {
    const { manager, names } = fakeLockManager();
    const { refresher } = refresherWith(
      () => Promise.resolve(sessionWith('kilitli')),
      createSessionLock(manager),
    );

    await refresher.refresh();

    expect(names).toEqual(['getir-oturum']);
  });
});

/**
 * Iki sekme, tek cerez kavanozu: gateway yenileme jetonunu her kullanimda
 * degistirir, kullanilmis jetona 401 verir ve cerezi siler (T8.5 PR 1).
 */
function rotatingServer() {
  let valid = 'r1';
  let issued = 1;
  const server = {
    /** Tarayicinin cerez kavanozu: iki sekme paylasir. */
    jar: 'r1' as string | null,
    async refresh(): Promise<AuthSession> {
      const sent = server.jar; // tarayici cerezi istek cikarken ekler
      await new Promise((resolve) => setTimeout(resolve, 5)); // ag
      if (sent === null || sent !== valid) {
        server.jar = null; // Set-Cookie: Max-Age=-1
        throw new AppError(ERROR_CODES.UNAUTHORIZED, 'x');
      }
      issued += 1;
      valid = `r${issued}`;
      server.jar = valid;
      return sessionWith(`erisim-${issued}`);
    },
  };
  return server;
}

function tab(server: ReturnType<typeof rotatingServer>, lock: SessionLock) {
  return refresherWith(() => server.refresh(), lock);
}

describe('iki sekme ayni anda yeniler (T8.5)', () => {
  it('ortak kilitle ikisi de oturumda kalir ve cerez gecerli kalir', async () => {
    const server = rotatingServer();
    const { manager } = fakeLockManager(); // ayni kaynak: tek kilit yoneticisi
    const first = tab(server, createSessionLock(manager));
    const second = tab(server, createSessionLock(manager));

    const tokens = await Promise.all([first.refresher.refresh(), second.refresher.refresh()]);

    expect(tokens.every((token) => token !== null)).toBe(true);
    expect(first.store.getState().status).toBe('authenticated');
    expect(second.store.getState().status).toBe('authenticated');
    expect(server.jar).not.toBeNull();
  });

  it('NEDEN KILIT: kilitsiz ikinci sekme kullanilmis jetonu gonderir ve cerez silinir', async () => {
    const server = rotatingServer();
    const noLock: SessionLock = (task) => task();
    const first = tab(server, noLock);
    const second = tab(server, noLock);

    const tokens = await Promise.all([first.refresher.refresh(), second.refresher.refresh()]);

    expect(tokens).toContain(null);
    expect(server.jar).toBeNull(); // bir sonraki yenilemede iki sekme de oturumsuz
  });
});
