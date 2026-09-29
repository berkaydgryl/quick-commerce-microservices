import { AppError, ERROR_CODES } from '@getir/core';
import { describe, expect, it } from 'vitest';

import { restoreSession } from '../../src/shared/session/restore-session';
import { createSessionRefresher } from '../../src/shared/session/session-refresher';
import { createSessionStore } from '../../src/shared/session/session-store';

import { sessionWith } from './session-test-support';

function restoreWith(refresh: () => Promise<ReturnType<typeof sessionWith>>) {
  const store = createSessionStore();
  const refresher = createSessionRefresher({
    refresh,
    session: store.getState(),
    lock: (task) => task(),
  });
  return { store, run: () => restoreSession({ refresher, session: store.getState() }) };
}

describe('acilista oturumu geri yukleme (T8.5)', () => {
  it('gecerli cerez: oturum acik', async () => {
    const { store, run } = restoreWith(() => Promise.resolve(sessionWith('jeton')));

    await run();

    expect(store.getState()).toMatchObject({ status: 'authenticated', accessToken: 'jeton' });
  });

  it('cerez yok ya da gecersiz (401): oturumsuz', async () => {
    const { store, run } = restoreWith(() =>
      Promise.reject(new AppError(ERROR_CODES.UNAUTHORIZED, 'x')),
    );

    await run();

    expect(store.getState().status).toBe('anonymous');
  });

  it('gecici hata: sekme oturumsuz acilir, "bilinmiyor"da takili kalmaz', async () => {
    const { store, run } = restoreWith(() =>
      Promise.reject(new AppError(ERROR_CODES.SERVICE_UNAVAILABLE, 'x')),
    );

    await expect(run()).resolves.toBeUndefined();

    expect(store.getState().status).toBe('anonymous');
  });
});
