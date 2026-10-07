import { useQuery } from '@tanstack/react-query';

import { authorizedClient } from '../../../shared/session/session';
import { orderDetailQuery } from '../api/queries';

/**
 * Siparis detayi (T11.16): GET /v1/orders/{id}; market adi ayrica (useMarket).
 * Son durumda olmayan sipariste yoklanir (F21; ayarlar api/queries.ts'te).
 */
export function useOrderDetail(userId: string, orderId: string) {
  return useQuery(orderDetailQuery(authorizedClient, userId, orderId));
}
