/**
 * Kurye takibi sorgusunun ayarlari (F22). Hook'tan ayri: istemci disaridan
 * verilir, birim testi sahte fetch'le QueryObserver uzerinden sinar.
 */

import type { OrderStatus, OrderTracking } from '@getir/contracts';
import { AppError, ERROR_CODES } from '@getir/core';
import { queryOptions } from '@tanstack/react-query';

import type { HttpClient } from '../../../shared/api/http-client';
import { shouldPollOrder } from '../../orders/services/order-track';
import { TRACKING_POLL_OPEN_MS, TRACKING_POLL_WATCH_MS } from '../constants';

import { trackingKeys } from './query-keys';
import { fetchOrderTracking } from './tracking.api';

/**
 * Takibin izlenme bicimi: kapali (istek yok), izle (pencere kapali, kurye
 * yolda: yaklasma icin 10 sn), acik (pencere acik: 2 sn) ya da bir kez
 * (pencere acik ama siparis son durumda: sozlesme geregi yoklanmaz).
 */
export type TrackingMode = 'off' | 'watch' | 'open' | 'once';

/**
 * Yoklama bicimi: pencere acikken 2 sn (siparis son durumdaysa yalniz bir
 * kez; sozlesme), kapaliyken kurye yoldaysa 10 sn, yoksa istek yok.
 */
export function trackingMode(open: boolean, status: OrderStatus): TrackingMode {
  if (open) {
    return shouldPollOrder(status) ? 'open' : 'once';
  }
  return status === 'ON_THE_WAY' ? 'watch' : 'off';
}

/**
 * Yoklama araligi. Sozlesme: takip yoksa (404) ve teslim edildiyse yoklama
 * BIRAKILIR. Baska hata (ag, 503) gecicidir: yoklama surer, takip geri gelir.
 */
export function trackingPollInterval(
  mode: TrackingMode,
  data: OrderTracking | undefined,
  error: unknown,
): number | false {
  if (
    mode === 'off' ||
    mode === 'once' ||
    data?.phase === 'DELIVERED' ||
    isTrackingMissing(error)
  ) {
    return false;
  }
  return mode === 'open' ? TRACKING_POLL_OPEN_MS : TRACKING_POLL_WATCH_MS;
}

/** Takip yok (404): kurye atanmadi ya da rota birakildi. */
export function isTrackingMissing(error: unknown): boolean {
  return error instanceof AppError && error.code === ERROR_CODES.NOT_FOUND;
}

export function orderTrackingQuery(
  client: HttpClient,
  userId: string,
  orderId: string,
  mode: TrackingMode,
) {
  return queryOptions({
    queryKey: trackingKeys.order(userId, orderId),
    queryFn: ({ signal }) => fetchOrderTracking(client, orderId, signal),
    enabled: mode !== 'off',
    refetchInterval: (query) => trackingPollInterval(mode, query.state.data, query.state.error),
    refetchIntervalInBackground: false,
  });
}
