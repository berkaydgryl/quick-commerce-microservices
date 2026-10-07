/**
 * Siparis detayi sorgusunun ayarlari (T11.16; F21 yoklama). Hook'tan ayri:
 * istemci disaridan verilir, birim testi sahte fetch'le QueryObserver
 * uzerinden sinar.
 */

import { queryOptions } from '@tanstack/react-query';

import type { HttpClient } from '../../../shared/api/http-client';
import { ORDER_TRACK_POLL_MS } from '../constants';
import { shouldPollOrder } from '../services/order-track';

import { fetchOrder } from './orders.api';
import { orderKeys } from './query-keys';

/**
 * GET /v1/orders/{id}. Siparis son durumda degilken 10 sn'de bir yeniden
 * istenir (F21; incelemedeki siparis onaylaninca cizgi kendiliginden gelir);
 * son durumda ve sekme gizliyken durur (refetchIntervalInBackground kapali).
 * T13.4 web soketi gelince kalkar.
 */
export function orderDetailQuery(client: HttpClient, userId: string, orderId: string) {
  return queryOptions({
    queryKey: orderKeys.detail(userId, orderId),
    queryFn: ({ signal }) => fetchOrder(client, orderId, signal),
    refetchInterval: (query) =>
      shouldPollOrder(query.state.data?.status) ? ORDER_TRACK_POLL_MS : false,
    refetchIntervalInBackground: false,
  });
}
