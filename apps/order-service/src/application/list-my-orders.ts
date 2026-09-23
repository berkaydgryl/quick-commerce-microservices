/**
 * Use-case: kullanicinin siparis gecmisi (ListMyOrders), yeniden eskiye.
 *
 * Sahiplik sorgunun kendisindedir: filtre userId'dir, baskasinin siparisi
 * listeye hic girmez. Bos liste hata degildir ("henuz siparisin yok").
 */

import type { OrderHistoryCursor } from '../domain/order-history-cursor.js';
import type { OrderHistoryPage, OrderHistoryReader } from '../domain/order-history-reader.js';

export interface ListMyOrdersDeps {
  readonly history: OrderHistoryReader;
}

export interface ListMyOrdersInput {
  readonly userId: string;
  readonly pageSize: number;
  readonly after?: OrderHistoryCursor | undefined;
}

export type ListMyOrders = (input: ListMyOrdersInput) => Promise<OrderHistoryPage>;

export function createListMyOrders(deps: ListMyOrdersDeps): ListMyOrders {
  return (input) => deps.history.listByUser(input);
}
