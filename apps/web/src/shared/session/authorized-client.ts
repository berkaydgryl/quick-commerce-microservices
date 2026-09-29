/**
 * Korumali uclarin istemcisi (T8.5): istege bellekteki erisim jetonunu ekler.
 *
 * 401 gelirse oturumu BIR KEZ yeniler ve istegi BIR KEZ tekrarlar; tekrarin
 * 401'i oldugu gibi doner (dongu yok). Yenileme "oturum yok" derse ilk 401 doner
 * ve durum "anonymous" olur; korumali sayfa giris ekranina yonlendirir.
 *
 * Tekrar guvenlidir: 401'i kimlik katmani verir, is yapilmamistir; gateway 401
 * cevabini idempotency kaydina yazmaz (ADR-08 eki), mutasyon ayni anahtarla
 * tekrarlanir.
 */

import { errorMessage } from '@getir/contracts';
import { AppError, ERROR_CODES } from '@getir/core';

import { hasErrorCode } from '../api/error-code';
import type { ApiRequest, HttpClient } from '../api/http-client';

import type { SessionRefresher } from './session-refresher';

export interface AuthorizedClientDeps {
  readonly client: HttpClient;
  /** Bellekteki erisim jetonu; oturum yoksa null. */
  readonly accessToken: () => string | null;
  readonly refresher: SessionRefresher;
}

export function createAuthorizedClient({
  client,
  accessToken,
  refresher,
}: AuthorizedClientDeps): HttpClient {
  /**
   * Reddedilen jetonun yerine gececek jeton. Bu arada baska bir istek yenilediyse
   * yeni jeton zaten bellektedir; ikinci kez yenilenmez.
   */
  const replacementFor = async (rejected: string): Promise<string | null> => {
    const current = accessToken();
    if (current !== null && current !== rejected) {
      return current;
    }
    return refresher.refresh();
  };

  return {
    async request<T>(path: string, request: ApiRequest<T>): Promise<T> {
      const token = accessToken();
      if (token === null) {
        // Oturum yokken korumali uca gidilmez: cevap belli (401).
        throw new AppError(ERROR_CODES.UNAUTHORIZED, errorMessage(ERROR_CODES.UNAUTHORIZED));
      }
      try {
        return await client.request(path, { ...request, accessToken: token });
      } catch (error) {
        if (!hasErrorCode(error, ERROR_CODES.UNAUTHORIZED)) {
          throw error;
        }
        const replacement = await replacementFor(token);
        if (replacement === null) {
          throw error;
        }
        return client.request(path, { ...request, accessToken: replacement });
      }
    },
  };
}
