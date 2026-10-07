/**
 * Kurye takibi sorgusunun ayarlari (F22). Hook'tan ayri: istemci disaridan
 * verilir, birim testi sahte fetch'le QueryObserver uzerinden sinar.
 */

import type { OrderStatus, OrderTracking } from '@getir/contracts';
import { queryOptions } from '@tanstack/react-query';

import type { HttpClient } from '../../../shared/api/http-client';
import { shouldPollOrder } from '../../orders/services/order-track';
import { TRACKING_POLL_OPEN_MS, TRACKING_POLL_WATCH_MS } from '../constants';
import { trackingErrorKind } from '../services/tracking-errors';

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
 * kez; sozlesme), kapaliyken kurye yoldaysa 10 sn. Yaklasma bildirimi bir kez
 * gosterildiyse kapali pencerede izleme durur (veri en aza; PM N4).
 */
export function trackingMode(
  open: boolean,
  status: OrderStatus,
  approachNotified = false,
): TrackingMode {
  if (open) {
    return shouldPollOrder(status) ? 'open' : 'once';
  }
  return status === 'ON_THE_WAY' && !approachNotified ? 'watch' : 'off';
}

/**
 * Yoklama araligi. Sozlesme: takip yoksa (404) ve teslim edildiyse yoklama
 * BIRAKILIR; son hatalarda da (yetki, gecersiz cevap) birakilir. Gecici hata
 * (503, ag) yoklamayi durdurmaz: takip geri gelir.
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
    trackingErrorKind(error) === 'final'
  ) {
    return false;
  }
  return mode === 'open' ? TRACKING_POLL_OPEN_MS : TRACKING_POLL_WATCH_MS;
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
