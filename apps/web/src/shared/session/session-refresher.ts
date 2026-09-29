/**
 * Sessiz yenileme (T8.5): cerezdeki yenileme jetonuyla yeni erisim jetonu alir.
 *
 * - Sekme icinde TEK UCUS: ayni anda 401 alan uc istek tek yenilemeyi bekler.
 * - Sekmeler arasi SIRA: oturum kilidi (session-lock.ts).
 * - Sonuc: yeni erisim jetonu. Oturum yoksa (cerez yok, gecersiz, iptal) null
 *   ve durum "anonymous". Gecici hata (ag, 503, 429) FIRLATILIR ve durum
 *   degismez: oturum bitmemistir, cagiran hatayi gosterir.
 */

import type { AuthSession } from '@getir/contracts';
import { ERROR_CODES } from '@getir/core';

import { hasErrorCode } from '../api/error-code';

import type { SessionLock } from './session-lock';
import type { SessionActions } from './session-store';

export interface SessionRefresherDeps {
  /** POST /v1/auth/refresh (session-api.ts). */
  readonly refresh: () => Promise<AuthSession>;
  readonly session: Pick<SessionActions, 'signIn' | 'signOut'>;
  readonly lock: SessionLock;
}

export interface SessionRefresher {
  /** Yeni erisim jetonu; oturum yoksa null. Gecici hatada firlatir. */
  readonly refresh: () => Promise<string | null>;
}

export function createSessionRefresher({
  refresh,
  session,
  lock,
}: SessionRefresherDeps): SessionRefresher {
  let inFlight: Promise<string | null> | undefined;

  const renew = async (): Promise<string | null> => {
    try {
      const next = await refresh();
      session.signIn(next);
      return next.accessToken;
    } catch (error) {
      if (hasErrorCode(error, ERROR_CODES.UNAUTHORIZED)) {
        session.signOut();
        return null;
      }
      throw error;
    }
  };

  return {
    refresh: () => {
      inFlight ??= lock(renew).finally(() => {
        inFlight = undefined;
      });
      return inFlight;
    },
  };
}
