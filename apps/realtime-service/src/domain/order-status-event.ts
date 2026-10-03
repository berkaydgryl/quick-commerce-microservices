/**
 * Ic olay -> soket olayi cevirisi (T12.3): order.status_changed -> order.status.
 *
 * Iki ayri sozluk (docs/api/socket-events.md "Ic olay adi <-> soket olay adi"):
 * ic olay domain diliyle `from`/`to`/`version` tasir; tarayiciya giden olay
 * `previousStatus`/`status`/`seq` tasir. Ic alanlar (`userId`, iptal notu)
 * BURADA birakilir: soket olayinda yerleri yoktur.
 *
 * `at` gecisin zaman cizelgesindeki anidir (zarfin occurredAt'i), realtime'in
 * yayin ani degil: istemci gecikmeden bagimsiz dogru zamani gosterir.
 */

import type { OrderStatusChangedPayload, OrderStatusEvent } from '@getir/contracts';

export function toOrderStatusEvent(
  payload: OrderStatusChangedPayload,
  occurredAt: string,
): OrderStatusEvent {
  return {
    orderId: payload.orderId,
    status: payload.to,
    ...(payload.from === undefined ? {} : { previousStatus: payload.from }),
    at: occurredAt,
    seq: payload.version,
  };
}
