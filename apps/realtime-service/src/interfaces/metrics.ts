/**
 * Realtime metrikleri (T10.5 kurallari): ad onek tasimaz, `service` etiketi
 * surecin defterinden gelir, etiket degerleri KAPALI kumedir (oda turu, sonuc,
 * olay adi). Siparis ya da kullanici kimligi etiket OLMAZ.
 */

import { counter, gauge } from '@getir/observability';
import type { SocketEventName } from '@getir/contracts';

import type { RoomKind } from '../domain/room.js';

export const METRIC_NAMES = {
  CONNECTIONS: 'realtime_connections',
  ROOM_JOINS: 'realtime_room_joins_total',
  EVENTS_EMITTED: 'realtime_events_emitted_total',
  EVENTS_DROPPED: 'realtime_events_dropped_total',
} as const;

/** Odanin ayristirilamadigi deneme icin oda etiketi. */
export const INVALID_ROOM_LABEL = 'invalid';

/** Basarili katilimin sonuc etiketi; basarisizlikta hata kodu yazilir. */
export const JOINED_OUTCOME = 'joined';

const connections = gauge({
  name: METRIC_NAMES.CONNECTIONS,
  help: 'Bu kopyadaki acik soket sayisi',
});

const roomJoins = counter<'room' | 'outcome'>({
  name: METRIC_NAMES.ROOM_JOINS,
  help: 'room.join denemeleri; room = oda turu, outcome = joined ya da hata kodu',
  labelNames: ['room', 'outcome'],
});

const eventsEmitted = counter<'event'>({
  name: METRIC_NAMES.EVENTS_EMITTED,
  help: 'Odaya yayinlanan olaylar (yayini yapan kopyada sayilir)',
  labelNames: ['event'],
});

const eventsDropped = counter<'event'>({
  name: METRIC_NAMES.EVENTS_DROPPED,
  help: 'Sema ya da oda kuralina uymadigi icin yayinlanmayan olaylar',
  labelNames: ['event'],
});

/** Kodun geri kalani metrik kutuphanesini bilmez; bu kucuk arayuzu kullanir. */
export interface RealtimeMetrics {
  connectionOpened(): void;
  connectionClosed(): void;
  roomJoin(room: RoomKind | typeof INVALID_ROOM_LABEL, outcome: string): void;
  eventEmitted(event: SocketEventName): void;
  eventDropped(event: SocketEventName): void;
}

export const realtimeMetrics: RealtimeMetrics = {
  connectionOpened: () => {
    connections.inc();
  },
  connectionClosed: () => {
    connections.dec();
  },
  roomJoin: (room, outcome) => {
    roomJoins.inc({ room, outcome });
  },
  eventEmitted: (event) => {
    eventsEmitted.inc({ event });
  },
  eventDropped: (event) => {
    eventsDropped.inc({ event });
  },
};
