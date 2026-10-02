/**
 * Harita adres uclari (T11.8): pinin oldugu noktanin adres satiri ve sokak /
 * posta kodu aramasi. Gateway OpenStreetMap Nominatim'e sinirli ve onbellekli
 * gider; tarayici Nominatim'i dogrudan cagirmaz. Korumali: yetkili istemciyle.
 */

import { geoSearchResultSchema, reverseGeocodeResultSchema } from '@getir/contracts';
import type { GeoPoint, GeoSearchResult, ReverseGeocodeResult } from '@getir/contracts';

import type { HttpClient } from '../../../shared/api/http-client';

/** GET /v1/geo/reverse: noktada adres yoksa NOT_FOUND (satiri kullanici yazar). */
export function reverseGeocode(
  client: HttpClient,
  point: GeoPoint,
  signal?: AbortSignal,
): Promise<ReverseGeocodeResult> {
  const params = new URLSearchParams({ lat: String(point.lat), lng: String(point.lng) });
  return client.request(`/v1/geo/reverse?${params.toString()}`, {
    schema: reverseGeocodeResultSchema,
    signal,
  });
}

/** GET /v1/geo/search: en fazla GEO_SEARCH_RESULTS_MAX sonuc; yoksa bos liste. */
export function searchPlaces(
  client: HttpClient,
  query: string,
  signal?: AbortSignal,
): Promise<GeoSearchResult> {
  const params = new URLSearchParams({ q: query });
  return client.request(`/v1/geo/search?${params.toString()}`, {
    schema: geoSearchResultSchema,
    signal,
  });
}
