/**
 * Odaya yayin kapisi (T12.1): sunucudan istemciye giden HER olay buradan gecer.
 *
 * PR 1'de bunu yalnizca testler kullanir; T12.3'teki olay tuketicisi (ic olay ->
 * soket olayi cevirisi) ayni kapiyi cagiracak. Kurallar sozlesmeden gelir
 * (docs/api/socket-events.md):
 *  - payload contracts semasindan gecer; gecmeyen paket ATILIR ve loglanir
 *    (roadmap "Socket payload'lari"). Yayinlanan, semanin AYRISTIRDIGI degerdir:
 *    semada olmayan alan (orn. sku) istemciye sizmaz.
 *  - stock.changed YALNIZCA store:{marketId} odasina, oteki olaylar YALNIZCA
 *    order:{orderId} odasina gider (B11: market odasi anonimdir).
 *  - olaydaki kimlik odanin kimligiyle ayni olmali: bir siparisin olayi baska
 *    siparisin odasina yanlislikla da olsa gidemez.
 *
 * Redis adapter kuruluysa yayin butun kopyalardaki soketlere ulasir.
 */

import { SOCKET_EVENT_SCHEMAS, SOCKET_EVENTS, stockChangedEventSchema } from '@getir/contracts';
import type { Logger } from '@getir/core';

import { parseRoom, ROOM_KINDS } from '../domain/room.js';
import type { Room } from '../domain/room.js';

/** Sunucudan istemciye giden olay adlari (room.join haric). */
export type ServerEventName = keyof typeof SOCKET_EVENT_SCHEMAS;

/** Yayinin altyapi tarafi (Socket.io: io.to(room).emit). */
export interface RoomEmitter {
  emit(room: string, event: ServerEventName, payload: unknown): void;
}

/** Yayin sayaclari; interfaces/metrics.ts karsilar. */
export interface BroadcastMetrics {
  eventEmitted(event: ServerEventName): void;
  eventDropped(event: ServerEventName): void;
}

/** Atilan olayin gerekcesi (gunluk icin, kapali kume). */
export const DROP_REASON = {
  INVALID_ROOM: 'invalid_room',
  WRONG_ROOM_KIND: 'wrong_room_kind',
  ROOM_MISMATCH: 'room_mismatch',
  INVALID_PAYLOAD: 'invalid_payload',
} as const;

export type DropReason = (typeof DROP_REASON)[keyof typeof DROP_REASON];

export interface BroadcastDeps {
  readonly emitter: RoomEmitter;
  readonly metrics: BroadcastMetrics;
  readonly logger: Logger;
}

/** Olayi odaya yayinlar; kurala uymayan olay atilir. Yayinlandiysa true. */
export type Broadcast = (room: string, event: ServerEventName, payload: unknown) => boolean;

export function createBroadcast(deps: BroadcastDeps): Broadcast {
  return (roomName, event, payload) => {
    const room = parseRoom(roomName);
    const checked = room === undefined ? DROP_REASON.INVALID_ROOM : check(room, event, payload);
    if (typeof checked === 'string') {
      deps.metrics.eventDropped(event);
      // Govde gunluge YAZILMAZ: ileride konum gibi kisisel veri tasiyabilir.
      deps.logger.error({ event, reason: checked }, 'olay sozlesmeye uymuyor, yayinlanmadi');
      return false;
    }
    deps.emitter.emit(roomName, event, checked.data);
    deps.metrics.eventEmitted(event);
    return true;
  };
}

/** Kurallari denetler; gecerse ayristirilmis govdeyi, gecmezse gerekceyi doner. */
function check(
  room: Room,
  event: ServerEventName,
  payload: unknown,
): { readonly data: unknown } | DropReason {
  if (event === SOCKET_EVENTS.STOCK_CHANGED) {
    const parsed = stockChangedEventSchema.safeParse(payload);
    if (!parsed.success) {
      return DROP_REASON.INVALID_PAYLOAD;
    }
    if (room.kind !== ROOM_KINDS.STORE) {
      return DROP_REASON.WRONG_ROOM_KIND;
    }
    return parsed.data.marketId === room.marketId
      ? { data: parsed.data }
      : DROP_REASON.ROOM_MISMATCH;
  }
  const parsed = SOCKET_EVENT_SCHEMAS[event].safeParse(payload);
  if (!parsed.success) {
    return DROP_REASON.INVALID_PAYLOAD;
  }
  if (room.kind !== ROOM_KINDS.ORDER) {
    return DROP_REASON.WRONG_ROOM_KIND;
  }
  return parsed.data.orderId === room.orderId ? { data: parsed.data } : DROP_REASON.ROOM_MISMATCH;
}
