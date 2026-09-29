/** POST /v1/auth/refresh (T8.5): govdesiz; jeton HttpOnly cerezden gider (ADR-12 eki). */

import { authSessionSchema } from '@getir/contracts';
import type { AuthSession } from '@getir/contracts';

import type { HttpClient } from '../api/http-client';

export function refreshSession(client: HttpClient, signal?: AbortSignal): Promise<AuthSession> {
  return client.request('/v1/auth/refresh', {
    method: 'POST',
    session: true,
    schema: authSessionSchema,
    signal,
  });
}
