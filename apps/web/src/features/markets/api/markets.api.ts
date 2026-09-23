/** GET /v1/markets ve GET /v1/markets/{marketId} (ADR-15). */

import { marketSchema, nearbyMarketListSchema } from '@getir/contracts';
import type { GeoPoint, Market, NearbyMarketList } from '@getir/contracts';

import type { HttpClient } from '../../../shared/api/http-client';

/** Konuma hizmet veren marketler, yakindan uzaga. Hic yoksa bos liste (hata degil). */
export function fetchNearbyMarkets(
  client: HttpClient,
  location: GeoPoint,
  signal?: AbortSignal,
): Promise<NearbyMarketList> {
  const query = new URLSearchParams({ lat: String(location.lat), lng: String(location.lng) });
  return client.request(`/v1/markets?${query.toString()}`, {
    schema: nearbyMarketListSchema,
    signal,
  });
}

/** Market sayfasinin basligi: puan, sure, fiyat kurallari. Olmayan market NOT_FOUND. */
export function fetchMarket(
  client: HttpClient,
  marketId: string,
  signal?: AbortSignal,
): Promise<Market> {
  return client.request(`/v1/markets/${encodeURIComponent(marketId)}`, {
    schema: marketSchema,
    signal,
  });
}
