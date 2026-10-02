/**
 * Gateway'e giden tek HTTP kapisi: istegi kurar, gonderir, cevabi zarftan
 * cikarir. Uclara ozgu bilgi (yol, sema) cagirandan gelir.
 *
 * Mutasyonlar Idempotency-Key'siz DERLENMEZ (ADR-08): istek tipi GET ile
 * yazan fiilleri ayri kollara boler ve yazan kolda anahtar zorunludur. Tek
 * istisna oturum uclaridir (SessionRequest); istisna adiyla secilir.
 *
 * Cerezler ayni kaynak kuraliyla gider (fetch varsayilani): yenileme jetonunun
 * cerezi (ADR-12 eki) web ile gateway ayni kaynaktayken tasinir.
 */

import { errorMessage } from '@getir/contracts';
import { AppError, ERROR_CODES } from '@getir/core';
import type { z } from 'zod';

import { unwrapEnvelope } from './envelope';

const IDEMPOTENCY_KEY_HEADER = 'Idempotency-Key';
const AUTHORIZATION_HEADER = 'Authorization';

interface BaseRequest<T> {
  /** Cevaptaki `data` alaninin semasi. */
  readonly schema: z.ZodType<T>;
  readonly signal?: AbortSignal | undefined;
  /**
   * Korumali uc icin erisim jetonu: "Authorization: Bearer <jeton>" (ADR-12).
   * Jetonu yetkili istemci ekler (shared/session/authorized-client.ts).
   */
  readonly accessToken?: string | undefined;
}

interface ReadRequest<T> extends BaseRequest<T> {
  readonly method?: 'GET';
}

interface MutationRequest<T> extends BaseRequest<T> {
  readonly method: 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  readonly idempotencyKey: string;
  readonly body?: unknown;
}

/**
 * Oturum uclari (giris, yenileme, cikis; T8.5): anahtarsiz POST. Kalici kaynak
 * yaratmazlar ve tekrarlari zararsizdir; gateway anahtar istemez (openapi,
 * ADR-08 ekindeki korunan uclar listesinde yoklar). Kayit bu kolda DEGILDIR:
 * hesap yaratir, anahtar ister.
 */
interface SessionRequest<T> extends BaseRequest<T> {
  readonly method: 'POST';
  readonly session: true;
  readonly body?: unknown;
}

/**
 * Govdeli okuma (T11.7): kalici bir sey degistirmeyen ama kisisel veriyi
 * adreste tasimamak icin POST kullanan uc (numara kontrolu, /v1/auth/phone-check).
 * Anahtar istemez: tekrari zararsizdir, kayit yaratmaz.
 */
interface BodyReadRequest<T> extends BaseRequest<T> {
  readonly method: 'POST';
  readonly readOnly: true;
  readonly body: unknown;
}

export type ApiRequest<T> =
  ReadRequest<T> | MutationRequest<T> | SessionRequest<T> | BodyReadRequest<T>;

export interface HttpClient {
  request<T>(path: string, request: ApiRequest<T>): Promise<T>;
}

export interface HttpClientDeps {
  /** Bos ise ayni kaynak. Sonunda "/" olmamali. */
  readonly baseUrl: string;
  readonly fetch: typeof fetch;
}

export function createHttpClient({ baseUrl, fetch }: HttpClientDeps): HttpClient {
  return {
    async request<T>(path: string, request: ApiRequest<T>): Promise<T> {
      const response = await send(fetch, `${baseUrl}${path}`, toRequestInit(request));
      const payload = await readJson(response);
      return unwrapEnvelope(request.schema, payload);
    },
  };
}

function toRequestInit<T>(request: ApiRequest<T>): RequestInit {
  const headers = new Headers({ Accept: 'application/json' });
  const init: RequestInit = { method: request.method ?? 'GET', headers };
  if (request.signal !== undefined) {
    init.signal = request.signal;
  }
  if (request.accessToken !== undefined) {
    headers.set(AUTHORIZATION_HEADER, `Bearer ${request.accessToken}`);
  }
  if ('idempotencyKey' in request) {
    headers.set(IDEMPOTENCY_KEY_HEADER, request.idempotencyKey);
  }
  if ('body' in request && request.body !== undefined) {
    headers.set('Content-Type', 'application/json');
    init.body = JSON.stringify(request.body);
  }
  return init;
}

/** Ag hatasini AppError'a cevirir; iptal (AbortError) oldugu gibi gecer. */
async function send(fetchFn: typeof fetch, url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetchFn(url, init);
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw error;
    }
    throw new AppError(
      ERROR_CODES.SERVICE_UNAVAILABLE,
      errorMessage(ERROR_CODES.SERVICE_UNAVAILABLE),
      { cause: error },
    );
  }
}

/**
 * Govdeyi JSON olarak okur. JSON olmayan cevap (proxy'nin HTML hata sayfasi,
 * bos 502) zarfa uymaz; gateway'e ulasilamamis sayilir.
 */
async function readJson(response: Response): Promise<unknown> {
  try {
    const payload: unknown = await response.json();
    return payload;
  } catch (error) {
    throw new AppError(
      ERROR_CODES.SERVICE_UNAVAILABLE,
      errorMessage(ERROR_CODES.SERVICE_UNAVAILABLE),
      { cause: error },
    );
  }
}
