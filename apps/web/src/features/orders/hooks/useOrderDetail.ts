import { useQuery } from '@tanstack/react-query';

import { authorizedClient } from '../../../shared/session/session';
import { fetchOrder } from '../api/orders.api';
import { orderKeys } from '../api/query-keys';

/** Siparis detayi (T11.16): GET /v1/orders/{id}; market adi ayrica (useMarket). */
export function useOrderDetail(userId: string, orderId: string) {
  return useQuery({
    queryKey: orderKeys.detail(userId, orderId),
    queryFn: ({ signal }) => fetchOrder(authorizedClient, orderId, signal),
  });
}
