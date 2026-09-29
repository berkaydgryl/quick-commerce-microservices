/**
 * Uygulamanin oturum parcalari (T8.5): tek kilit, tek yenileyici, tek yetkili
 * istemci. Korumali uclara giden her ozellik authorizedClient'i kullanir.
 */

import { apiClient } from '../api/client';
import { SESSION_REFRESH_TIMEOUT_MS } from '../config/constants';

import { createAuthorizedClient } from './authorized-client';
import { browserLockManager, createSessionLock } from './session-lock';
import { refreshSession } from './session-api';
import { createSessionRefresher } from './session-refresher';
import { useSessionStore } from './session-store';

export const sessionLock = createSessionLock(browserLockManager());

export const sessionRefresher = createSessionRefresher({
  // Sure siniri kilidin tutulma suresini de sinirlar: asili bir yenileme
  // diger sekmeleri sonsuza dek bekletmez.
  refresh: () => refreshSession(apiClient, AbortSignal.timeout(SESSION_REFRESH_TIMEOUT_MS)),
  session: useSessionStore.getState(),
  lock: sessionLock,
});

export const authorizedClient = createAuthorizedClient({
  client: apiClient,
  accessToken: () => useSessionStore.getState().accessToken,
  refresher: sessionRefresher,
});
