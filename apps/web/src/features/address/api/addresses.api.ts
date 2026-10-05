/**
 * Adres defteri uclari: GET /v1/me/addresses (T9.5), POST /v1/me/addresses
 * (T11.8), PUT ve DELETE /v1/me/addresses/{addressId} (T11.15). Hepsi
 * korumali: yetkili istemciyle cagrilir.
 */

import { savedAddressListSchema } from '@getir/contracts';
import type {
  CreateAddressRequest,
  SavedAddressList,
  UpdateAddressRequest,
} from '@getir/contracts';

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

/** Adres yolu: kimlik URL'de kodlanir (bicimi adr_ + hex; yine de guvenli). */
function addressPath(addressId: string): string {
  return `/v1/me/addresses/${encodeURIComponent(addressId)}`;
}

/**
 * Adresi tam govdeyle degistirir (T11.15); cevap GUNCEL defterdir. Kalici
 * kayit: anahtar ister. Ad baska adreste VALIDATION_FAILED (title), adres
 * yoksa NOT_FOUND.
 */
export function updateSavedAddress(
  client: HttpClient,
  addressId: string,
  request: UpdateAddressRequest,
  idempotencyKey: string,
): Promise<SavedAddressList> {
  return client.request(addressPath(addressId), {
    method: 'PUT',
    idempotencyKey,
    body: request,
    schema: savedAddressListSchema,
  });
}

/** Adresi defterden siler (T11.15); govdesiz, cevap GUNCEL defterdir. Adres yoksa NOT_FOUND. */
export function deleteSavedAddress(
  client: HttpClient,
  addressId: string,
  idempotencyKey: string,
): Promise<SavedAddressList> {
  return client.request(addressPath(addressId), {
    method: 'DELETE',
    idempotencyKey,
    schema: savedAddressListSchema,
  });
}
