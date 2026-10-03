/**
 * QA kara kutu: yayin kapisinin kurallari tel uzerinde (socket-events.md "Yayin
 * kurallari (sunucu)"). Kapidan gecmeyen olay hicbir istemciye ulasmamali; gecen
 * olayda semada olmayan alan istemciye sizmamali (tutar, kisisel veri).
 *
 * Backend'in testi iki mutlu yolu ve stock.changed'in fazla alanini sinar; burada
 * reddedilmesi gereken yollar ve siparis olaylarinin fazla alani denenir.
 */

import { SOCKET_EVENTS } from '@getir/contracts';
import type { Socket } from 'socket.io-client';
import { afterEach, describe, expect, it } from 'vitest';

import { collectEvents, joinRoom, nextEvent } from '../support/clients.js';
import {
  orderStatusFor,
  QA_NOW_MS,
  startQaServer,
  stockChangedFor,
} from '../support/qa-harness.js';
import type { QaServer } from '../support/qa-harness.js';
import {
  MARKET_ID,
  ORDER_ID,
  ORDER_ROOM,
  OTHER_ORDER_ID,
  signRoomToken,
  STORE_ROOM,
} from '../support/tokens.js';

const AT = '2026-10-03T12:00:00.000Z';
const COURIER_ID = 'crr_0123456789abcdef0123456789abcdef';

let qa: QaServer | undefined;

afterEach(async () => {
  await qa?.close();
  qa = undefined;
});

interface Rooms {
  readonly qa: QaServer;
  /** order:{ORDER_ID} odasinda, jetonla. */
  readonly owner: Socket;
  /** store:{MARKET_ID} odasinda, anonim. */
  readonly shopper: Socket;
}

async function joinBothRooms(): Promise<Rooms> {
  const server = await startQaServer();
  qa = server;
  const [owner, shopper] = await Promise.all([server.client(), server.client()]);
  await joinRoom(owner, { room: ORDER_ROOM, token: await signRoomToken(QA_NOW_MS) });
  await joinRoom(shopper, { room: STORE_ROOM });
  return { qa: server, owner, shopper };
}

/** Iki istemcinin de hicbir olay almadigini toplar. */
function silenceOn(sockets: readonly Socket[], event: string): Promise<unknown[][]> {
  return Promise.all(sockets.map((socket) => collectEvents(socket, event)));
}

describe('kapidan gecmeyen olay hicbir istemciye ulasmaz', () => {
  it('QA-RT-80: siparis olayi market odasina yayinlanmaz', async () => {
    const { qa: server, owner, shopper } = await joinBothRooms();
    const silence = silenceOn([owner, shopper], SOCKET_EVENTS.ORDER_STATUS);

    expect(server.server.broadcast(STORE_ROOM, 'order.status', orderStatusFor(ORDER_ID))).toBe(
      false,
    );
    await expect(silence).resolves.toEqual([[], []]);
  });

  it('QA-RT-81: stock.changed siparis odasina yayinlanmaz', async () => {
    const { qa: server, owner, shopper } = await joinBothRooms();
    const silence = silenceOn([owner, shopper], SOCKET_EVENTS.STOCK_CHANGED);

    expect(server.server.broadcast(ORDER_ROOM, 'stock.changed', stockChangedFor(MARKET_ID))).toBe(
      false,
    );
    await expect(silence).resolves.toEqual([[], []]);
  });

  it.each([
    [
      'baska siparisin olayi bu siparisin odasina',
      ORDER_ROOM,
      'order.status',
      orderStatusFor(OTHER_ORDER_ID),
    ],
    [
      'baska marketin stogu bu marketin odasina',
      STORE_ROOM,
      'stock.changed',
      stockChangedFor('mkt_baska-market'),
    ],
  ] as const)(
    'QA-RT-82: %s yayinlanmaz (kimlik odayla ayni olmali)',
    async (_name, room, event, payload) => {
      const { qa: server, owner, shopper } = await joinBothRooms();
      const silence = silenceOn([owner, shopper], event);

      expect(server.server.broadcast(room, event, payload)).toBe(false);
      await expect(silence).resolves.toEqual([[], []]);
    },
  );

  it.each([
    ['seq sifir', { ...orderStatusFor(ORDER_ID), seq: 0 }],
    ['at yok', { orderId: ORDER_ID, status: 'PAID', seq: 1 }],
    ['bilinmeyen durum', { ...orderStatusFor(ORDER_ID), status: 'TELEPORTED' }],
    ['govde metin', 'PAID'],
  ])('QA-RT-83: semaya uymayan order.status (%s) yayinlanmaz', async (_name, payload) => {
    const { qa: server, owner } = await joinBothRooms();
    const silence = collectEvents(owner, SOCKET_EVENTS.ORDER_STATUS);

    expect(server.server.broadcast(ORDER_ROOM, 'order.status', payload)).toBe(false);
    await expect(silence).resolves.toEqual([]);
  });

  it('QA-RT-83b: bicimsiz oda adina yayin yapilmaz', async () => {
    const { qa: server, owner } = await joinBothRooms();
    const silence = collectEvents(owner, SOCKET_EVENTS.ORDER_STATUS);

    expect(server.server.broadcast('order:', 'order.status', orderStatusFor(ORDER_ID))).toBe(false);
    await expect(silence).resolves.toEqual([]);
  });
});

describe('gecen olayda semada olmayan alan istemciye sizmaz (QA-RT-84)', () => {
  it('order.status: tutar ve kullanici alani cikarilir', async () => {
    const { qa: server, owner } = await joinBothRooms();
    const received = nextEvent(owner, SOCKET_EVENTS.ORDER_STATUS);

    server.server.broadcast(ORDER_ROOM, 'order.status', {
      ...orderStatusFor(ORDER_ID),
      totalMinor: 12_345,
      userId: 'usr_0123456789abcdef0123456789abcdef',
    });

    await expect(received).resolves.toEqual(orderStatusFor(ORDER_ID));
  });

  it('courier.location: kuryenin telefonu ve adres alani cikarilir', async () => {
    const { qa: server, owner } = await joinBothRooms();
    const location = {
      orderId: ORDER_ID,
      courierId: COURIER_ID,
      location: { lat: 40.9885, lng: 29.0262 },
      at: AT,
      seq: 4,
    };
    const received = nextEvent(owner, SOCKET_EVENTS.COURIER_LOCATION);

    server.server.broadcast(ORDER_ROOM, 'courier.location', {
      ...location,
      courierPhone: '+905551112233',
      deliveryAddress: 'Caferaga Mah. Moda Cad. No:12',
    });

    await expect(received).resolves.toEqual(location);
  });
});
