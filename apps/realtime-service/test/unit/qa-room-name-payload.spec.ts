/**
 * QA kara kutu: oda adi ve room.join govdesi tel uzerinde (T12.2;
 * socket-events.md "Oda adi bicimi" ve "Hata kodlari"). Sozlesme semasinin
 * kendisi contracts'ta sinanir; burada sunucunun ayni kurali UYGULADIGI ve bozuk
 * girdiden sonra ayakta kaldigi denenir.
 */

import { ROOM_NAME_MAX_LENGTH, SOCKET_EVENTS } from '@getir/contracts';
import type { Socket } from 'socket.io-client';
import { afterEach, describe, expect, it } from 'vitest';

import { collectEvents, EVENT_TIMEOUT_MS, joinRoom, nextEvent } from '../support/clients.js';
import {
  failure,
  orderStatusFor,
  QA_NOW_MS,
  startQaServer,
  stockChangedFor,
} from '../support/qa-harness.js';
import type { QaServer } from '../support/qa-harness.js';
import { MARKET_ID, ORDER_ID, ORDER_ROOM, signRoomToken, STORE_ROOM } from '../support/tokens.js';

let qa: QaServer | undefined;

afterEach(async () => {
  await qa?.close();
  qa = undefined;
});

/** Sunucunun bozuk girdiden sonra hala calistiginin kaniti: gecerli katilim basarili. */
async function expectStillServing(socket: Socket): Promise<void> {
  await expect(joinRoom(socket, { room: STORE_ROOM })).resolves.toEqual({
    success: true,
    data: { room: STORE_ROOM },
  });
}

/** Gecerli bir market kimligi, oda adi tam `length` karakter olacak sekilde. */
function storeRoomOfLength(length: number): string {
  const prefix = 'store:mkt_';
  return `${prefix}${'a'.repeat(length - prefix.length)}`;
}

describe('oda adi tel uzerinde (QA-RT-30/31)', () => {
  it.each([
    ['tanimsiz onek', 'admin:x'],
    ['buyuk harfli onek', `ORDER:${ORDER_ID}`],
    ['basta bosluk', ` ${ORDER_ROOM}`],
    ['sonda bosluk', `${ORDER_ROOM} `],
    ['buyuk harfli siparis kimligi', `order:${ORDER_ID.toUpperCase()}`],
    ['bos siparis odasi', 'order:'],
    ['bos market odasi', 'store:'],
    ['bicimsiz siparis kimligi', 'order:ord_XYZ'],
    ['yol gezinmesi', 'store:mkt_../x'],
    ['sinirdan bir uzun market odasi', storeRoomOfLength(ROOM_NAME_MAX_LENGTH + 1)],
    // 4 KB'lik paket sinirinin altinda kalir: asan paket baglantiyi keser (backend testi).
    ['3 KB ad', `store:mkt_${'a'.repeat(3 * 1024)}`],
  ])('%s -> VALIDATION_FAILED ve sunucu calismaya devam eder', async (_name, room) => {
    qa = await startQaServer();
    const socket = await qa.client();

    await expect(joinRoom(socket, { room })).resolves.toEqual(failure('VALIDATION_FAILED'));
    await expectStillServing(socket);
  });

  it(`tam ${ROOM_NAME_MAX_LENGTH} karakterlik gecerli market odasi kabul edilir (sinir)`, async () => {
    qa = await startQaServer();
    const socket = await qa.client();
    const room = storeRoomOfLength(ROOM_NAME_MAX_LENGTH);

    await expect(joinRoom(socket, { room })).resolves.toEqual({ success: true, data: { room } });
  });
});

describe('room.join govdesi (QA-RT-32)', () => {
  it.each([
    ['metin', ORDER_ROOM],
    ['null', null],
    ['dizi', [ORDER_ROOM]],
    ['sayi', 42],
    ['bos nesne', {}],
    ['room metin degil', { room: 123 }],
  ])('govde %s ise VALIDATION_FAILED ve sunucu calismaya devam eder', async (_name, payload) => {
    qa = await startQaServer();
    const socket = await qa.client();

    await expect(joinRoom(socket, payload)).resolves.toEqual(failure('VALIDATION_FAILED'));
    await expectStillServing(socket);
  });

  it('govdesiz, yalnizca ack ile gonderim VALIDATION_FAILED', async () => {
    qa = await startQaServer();
    const socket = await qa.client();

    await expect(
      socket.timeout(EVENT_TIMEOUT_MS).emitWithAck(SOCKET_EVENTS.ROOM_JOIN),
    ).resolves.toEqual(failure('VALIDATION_FAILED'));
    await expectStillServing(socket);
  });

  it('QA-RT-34: fazla alanli govde kabul edilir, fazla alan yan etki yaratmaz', async () => {
    qa = await startQaServer();
    const socket = await qa.client();
    const token = await signRoomToken(QA_NOW_MS);

    await expect(
      joinRoom(socket, {
        room: ORDER_ROOM,
        token,
        admin: true,
        rooms: ['order:ord_ffffffffffffffffffffffffffffffff'],
      }),
    ).resolves.toEqual({ success: true, data: { room: ORDER_ROOM } });
  });
});

describe('istemci sunucuya veri yazmaz (QA-RT-35)', () => {
  it.each([
    [SOCKET_EVENTS.STOCK_CHANGED, STORE_ROOM, () => stockChangedFor(MARKET_ID)],
    [SOCKET_EVENTS.ORDER_STATUS, ORDER_ROOM, () => orderStatusFor(ORDER_ID)],
  ])('istemcinin gonderdigi %s ayni odadaki baskasina ulasmaz', async (event, room, payload) => {
    qa = await startQaServer();
    const [sender, listener] = await Promise.all([qa.client(), qa.client()]);
    const token = await signRoomToken(QA_NOW_MS);
    await joinRoom(sender, { room, token });
    await joinRoom(listener, { room, token });

    const silence = collectEvents(listener, event);
    sender.emit(event, payload());
    sender.emit(event, { room, ...payload() });

    await expect(silence).resolves.toEqual([]);
    // Sunucu sahte olaydan sonra gercek yayini hala dagitir.
    const real = nextEvent(listener, event);
    qa.server.broadcast(room, event, payload());
    await expect(real).resolves.toEqual(payload());
  });
});
