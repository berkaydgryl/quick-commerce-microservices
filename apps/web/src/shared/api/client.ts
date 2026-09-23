/** Uygulamanin paylastigi HTTP istemcisi: tarayicinin fetch'i + ortamdaki kok adres. */

import { env } from '../config/env';

import { createHttpClient } from './http-client';

export const apiClient = createHttpClient({
  baseUrl: env.apiBaseUrl,
  fetch: globalThis.fetch.bind(globalThis),
});
