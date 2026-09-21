/**
 * Socket.io sozlesmesi (docs/api/socket-events.md).
 *
 * Akis TEK YONLUDUR: sunucu ic olay yolundan (Redis Streams) aldigini odaya
 * yayinlar, istemci sunucuya veri YAZMAZ. Bu yuzden istemciden sunucuya giden
 * tek olay room.join'dir.
 *
 * SOKET OLAY ADLARI ILE IC OLAY ADLARI AYRI SOZLUKLERDIR. Ic olaylar
 * (@getir/core icindeki EVENTS) servisler arasinda akar ve domain diliyle
 * yazilir; buradakiler tarayiciya gider ve istemcinin ihtiyacina gore
 * sadelestirilir. Ornegin ic taraftaki stock.released, siparis odasina
 * reservation.released olarak cikar. Ceviriyi realtime-service tek yerde yapar.
 *
 * PARA ALANI YOKTUR: bu olaylar tutar tasimaz. Tutar gerektiginde istemci
 * GET /v1/orders/{id} ile okur, boylece kurus mantigi tek yerde kalir.
 */

import { z } from 'zod';

import { geoPointSchema, idSchema, isoDateTimeSchema } from './common.js';
import { ROOM_PREFIX } from './constants.js';
import { orderStatusSchema } from './order.js';

/** Tarayiciya giden olay adlari. */
export const SOCKET_EVENTS = {
  ROOM_JOIN: 'room.join',
  ORDER_STATUS: 'order.status',
  RESERVATION_EXPIRING: 'reservation.expiring',
  RESERVATION_RELEASED: 'reservation.released',
  COURIER_ASSIGNED: 'courier.assigned',
  COURIER_LOCATION: 'courier.location',
  ORDER_DELIVERED: 'order.delivered',
  STOCK_CHANGED: 'stock.changed',
} as const;

export type SocketEventName = (typeof SOCKET_EVENTS)[keyof typeof SOCKET_EVENTS];

/** Siparis odasi: yalnizca sahibi girer, oda jetonu sarttir. */
export function orderRoom(orderId: string): string {
  return `${ROOM_PREFIX.order}${orderId}`;
}

/** Depo odasi: herkese acik, yalnizca stok degisimi tasir. */
export function storeRoom(darkStoreId: string): string {
  return `${ROOM_PREFIX.store}${darkStoreId}`;
}

/**
 * Sira numarasi.
 *
 * Siparis odasindaki her olay, o siparis icin 1'den baslayan monoton artan bir
 * numara tasir. Socket.io yeniden baglanmada sirayi garanti etmedigi icin
 * istemci, gordugu en buyuk seq'ten kucuk ya da esit geleni YOK SAYAR. Ozellikle
 * courier.location iki saniyede bir aktigindan, geciken eski bir konum
 * haritada kuryeyi geri sicratmamalidir.
 */
export const seqSchema = z.number().int().positive();

/** Oda adi: yalnizca iki onekten biri olabilir. */
export const roomSchema = z
  .string()
  .refine((value) => value.startsWith(ROOM_PREFIX.order) || value.startsWith(ROOM_PREFIX.store), {
    message: 'Oda adi order: veya store: onekiyle baslamalidir',
  });

/**
 * Oda jetonu (GET /v1/orders/{id}/token cevabi).
 *
 * Jeton TEK BIR odaya yetkilidir ve kisa omurludur. REST cevabi olmasina ragmen
 * burada duruyor cunku anlamli oldugu tek yer soket el sikismasidir.
 */
export const realtimeTokenSchema = z.object({
  token: z.string(),
  room: roomSchema,
  expiresAt: isoDateTimeSchema,
  ttlSeconds: z.number().int().positive(),
});

/** Istemci -> sunucu. store:* icin token gerekmez, order:* icin zorunludur. */
export const roomJoinPayloadSchema = z.object({
  room: roomSchema,
  token: z.string().optional(),
});

/** room.join ack'inin basari kolundaki veri. */
export const roomJoinResultSchema = z.object({
  room: roomSchema,
});

export const orderStatusEventSchema = z.object({
  orderId: idSchema,
  status: orderStatusSchema,
  /** Ilk geciste bos olabilir; istemci gecis animasyonunu buna gore kurar. */
  previousStatus: orderStatusSchema.optional(),
  at: isoDateTimeSchema,
  seq: seqSchema,
});

/**
 * Rezervasyon suresi dolmadan once gonderilen uyari.
 *
 * Karsiligi olan bir IC OLAY YOKTUR: realtime-service bunu expiresAt uzerinden
 * kendisi uretir.
 */
export const reservationExpiringEventSchema = z.object({
  orderId: idSchema,
  expiresAt: isoDateTimeSchema,
  /** Geri sayim icin dogrudan kullanilir; istemci saat farki hesaplamaz. */
  remainingSeconds: z.number().int().min(0),
  seq: seqSchema,
});

/** Serbest birakma gerekcesi; uc degerden biri. */
export const reservationReleaseReasonSchema = z.enum(['EXPIRED', 'CANCELLED', 'PAYMENT_FAILED']);

export const reservationReleasedEventSchema = z.object({
  orderId: idSchema,
  reason: reservationReleaseReasonSchema,
  releasedAt: isoDateTimeSchema,
  seq: seqSchema,
});

export const courierAssignedEventSchema = z.object({
  orderId: idSchema,
  courier: z.object({
    id: idSchema,
    name: z.string(),
    location: geoPointSchema.optional(),
    etaMinutes: z.number().int().min(0).optional(),
  }),
  at: isoDateTimeSchema,
  seq: seqSchema,
});

export const courierLocationEventSchema = z.object({
  orderId: idSchema,
  courierId: idSchema,
  location: geoPointSchema,
  etaMinutes: z.number().int().min(0).optional(),
  at: isoDateTimeSchema,
  seq: seqSchema,
});

export const orderDeliveredEventSchema = z.object({
  orderId: idSchema,
  deliveredAt: isoDateTimeSchema,
  seq: seqSchema,
});

/**
 * Depo odasina yayin.
 *
 * DISARIYA sku CIKMAZ: bu olay productId tasir. sku ic birlestirme anahtaridir
 * ve anonim baglanabilen bir odada paylasilmaz (B11). seq alani da yoktur;
 * sira garantisi yalnizca siparis odasinda anlamlidir.
 */
export const stockChangedEventSchema = z.object({
  darkStoreId: idSchema,
  productId: idSchema,
  availableQuantity: z.number().int().min(0),
  at: isoDateTimeSchema,
});

export type Seq = z.infer<typeof seqSchema>;
export type Room = z.infer<typeof roomSchema>;
export type RealtimeToken = z.infer<typeof realtimeTokenSchema>;
export type RoomJoinPayload = z.infer<typeof roomJoinPayloadSchema>;
export type RoomJoinResult = z.infer<typeof roomJoinResultSchema>;
export type OrderStatusEvent = z.infer<typeof orderStatusEventSchema>;
export type ReservationExpiringEvent = z.infer<typeof reservationExpiringEventSchema>;
export type ReservationReleaseReason = z.infer<typeof reservationReleaseReasonSchema>;
export type ReservationReleasedEvent = z.infer<typeof reservationReleasedEventSchema>;
export type CourierAssignedEvent = z.infer<typeof courierAssignedEventSchema>;
export type CourierLocationEvent = z.infer<typeof courierLocationEventSchema>;
export type OrderDeliveredEvent = z.infer<typeof orderDeliveredEventSchema>;
export type StockChangedEvent = z.infer<typeof stockChangedEventSchema>;

/**
 * Olay adi -> payload semasi eslemesi.
 *
 * realtime-service yayin yaparken ve web istemcisi dinlerken ayni tabloyu
 * kullanir; boylece bir olayin adi ile govdesi arasindaki bag tek yerde durur.
 */
export const SOCKET_EVENT_SCHEMAS = {
  [SOCKET_EVENTS.ORDER_STATUS]: orderStatusEventSchema,
  [SOCKET_EVENTS.RESERVATION_EXPIRING]: reservationExpiringEventSchema,
  [SOCKET_EVENTS.RESERVATION_RELEASED]: reservationReleasedEventSchema,
  [SOCKET_EVENTS.COURIER_ASSIGNED]: courierAssignedEventSchema,
  [SOCKET_EVENTS.COURIER_LOCATION]: courierLocationEventSchema,
  [SOCKET_EVENTS.ORDER_DELIVERED]: orderDeliveredEventSchema,
  [SOCKET_EVENTS.STOCK_CHANGED]: stockChangedEventSchema,
} as const;
