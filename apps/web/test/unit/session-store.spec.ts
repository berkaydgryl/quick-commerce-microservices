import { describe, expect, it } from 'vitest';

import {
  ANONYMOUS_SESSION,
  createSessionStore,
  UNKNOWN_SESSION,
} from '../../src/shared/session/session-store';

import { sessionWith, USER } from './session-test-support';

describe('oturum deposu (T8.5)', () => {
  it('acilista durum bilinmez: sessiz yenileme henuz donmedi', () => {
    expect(createSessionStore().getState()).toMatchObject(UNKNOWN_SESSION);
  });

  it('giris jetonu ve kullaniciyi bellege yazar', () => {
    const store = createSessionStore();

    store.getState().signIn(sessionWith('jeton-1'));

    expect(store.getState()).toMatchObject({
      status: 'authenticated',
      accessToken: 'jeton-1',
      user: USER,
    });
  });

  it('cikis jetonu da siler: eski jeton bellekte kalmaz', () => {
    // Zustand set() birlestirir; yalnizca durum yazilsaydi jeton kalirdi.
    const store = createSessionStore();
    store.getState().signIn(sessionWith('jeton-1'));

    store.getState().signOut();

    expect(store.getState()).toMatchObject(ANONYMOUS_SESSION);
    expect(store.getState().accessToken).toBeNull();
  });
});
