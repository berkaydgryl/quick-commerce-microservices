/** GET /v1/content/welcome - karsilama ekraninin metinleri ve gorselleri (T11.6). */

import { welcomeContentSchema } from '@getir/contracts';
import type { WelcomeContent } from '@getir/contracts';

import type { HttpClient } from '../../../shared/api/http-client';

export function fetchWelcomeContent(
  client: HttpClient,
  signal?: AbortSignal,
): Promise<WelcomeContent> {
  return client.request('/v1/content/welcome', { schema: welcomeContentSchema, signal });
}
