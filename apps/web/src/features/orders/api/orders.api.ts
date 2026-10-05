/**
 * Siparis okuma uclari (T11.16): GET /v1/orders (gecmis, sayfali ozet) ve
 * GET /v1/orders/{id} (tam siparis). Ikisi de korumali: yetkili istemciyle
 * cagrilir; cevaplar sozlesmeyle dogrulanir.
 */

import {
  ORDER_HISTORY_PAGE_SIZE_DEFAULT,
  orderSchema,
  orderSummaryListSchema,
} from '@getir/contracts';
import type { Order, OrderSummaryList, Page } from '@getir/contracts';

import type { HttpClient } from '../../../shared/api/http-client';

/**
 * Gecmisin bir sayfasi, yeniden eskiye. pageToken yoksa ilk sayfa. Sepet
 * taslaklari listede yoktur (gateway gizler).
 */
export function fetchOrderHistory(
  client: HttpClient,
  pageToken: string | undefined,
  signal?: AbortSignal,
): Promise<OrderSummaryList> {
  const params = new URLSearchParams({ pageSize: String(ORDER_HISTORY_PAGE_SIZE_DEFAULT) });
  if (pageToken !== undefined) params.set('pageToken', pageToken);
  return client.request(`/v1/orders?${params.toString()}`, {
    schema: orderSummaryListSchema,
    signal,
  });
}

/** Kullanicinin tek siparisi; baskasinin ya da olmayan siparis NOT_FOUND. */
export function fetchOrder(
  client: HttpClient,
  orderId: string,
  signal?: AbortSignal,
): Promise<Order> {
  return client.request(`/v1/orders/${encodeURIComponent(orderId)}`, {
    schema: orderSchema,
    signal,
  });
}

/** Imlec: bos token listenin bittigi demektir (sozlesme), undefined'a cevrilir. */
export function nextHistoryPage(page: Page): string | undefined {
  return page.nextPageToken === '' ? undefined : page.nextPageToken;
}
