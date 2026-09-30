/**
 * GET /v1/search (T9.6): markete girmeden, konuma hizmet veren marketlerde
 * urun ya da market adi. Sonuc market market, mesafe sirasinda gelir.
 */

import { searchResultListSchema } from '@getir/contracts';
import type { GeoPoint, SearchResultList } from '@getir/contracts';

import type { HttpClient } from '../../../shared/api/http-client';

/**
 * Genel arama. Arama metni cagirandan gecerli gelir (searchQueryFrom: kirpilmis,
 * 2-64 karakter); kural sunucudadir, burada tekrar yazilmaz. Eslesme yoksa bos
 * liste (hata degil).
 */
export function fetchNearbySearch(
  client: HttpClient,
  location: GeoPoint,
  query: string,
  signal?: AbortSignal,
): Promise<SearchResultList> {
  const params = new URLSearchParams({
    lat: String(location.lat),
    lng: String(location.lng),
    q: query,
  });
  return client.request(`/v1/search?${params.toString()}`, {
    schema: searchResultListSchema,
    signal,
  });
}
