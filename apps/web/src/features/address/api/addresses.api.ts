/**
 * Adres defteri uclari: GET /v1/me/addresses (T9.5) ve POST /v1/me/addresses
 * (T11.8). Ikisi de korumali: yetkili istemciyle cagrilir.
 */

import { savedAddressListSchema } from '@getir/contracts';
import type { CreateAddressRequest, SavedAddressList } from '@getir/contracts';

import type { HttpClient } from '../../../shared/api/http-client';

/**
 * Korumali: yetkili istemciyle cagrilir (erisim jetonu). Kayit sirasinda, en
 * fazla SAVED_ADDRESSES_MAX adres; adresi olmayan hesapta bos liste (hata degil).
 */
export function fetchSavedAddresses(
  client: HttpClient,
  signal?: AbortSignal,
): Promise<SavedAddressList> {
  return client.request('/v1/me/addresses', { schema: savedAddressListSchema, signal });
}

/**
 * Deftere yeni adres (T11.8); cevap GUNCEL defterdir. Kalici kayit: anahtar
 * ister (ADR-08). Ayni ad ve dolu defter VALIDATION_FAILED (title, addresses).
 */
export function addSavedAddress(
  client: HttpClient,
  request: CreateAddressRequest,
  idempotencyKey: string,
): Promise<SavedAddressList> {
  return client.request('/v1/me/addresses', {
    method: 'POST',
    idempotencyKey,
    body: request,
    schema: savedAddressListSchema,
  });
}
