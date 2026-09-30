/** GET /v1/me/addresses (T9.5): oturumdaki kullanicinin adres defteri. */

import { savedAddressListSchema } from '@getir/contracts';
import type { SavedAddressList } from '@getir/contracts';

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
