/**
 * QA kara kutu: room.join siniri (socket-events.md "room.join nasil karar verir",
 * 1. adim): ayni soketten 10 sn icinde en fazla 10 deneme; sinir her denetimden
 * once gelir ve sayac sokete baglidir.
 *
 * Backend'in testlerinde olanlar (11. denemenin bozuk adla da RATE_LIMITED olmasi,
 * yeniden baglanan istemcinin sayacinin sifir olmasi) burada yinelenmez.
 */

import { SOCKET_EVENTS } from '@getir/contracts';
import { afterEach, describe, expect, it } from 'vitest';

import { joinRoom, nextEvent } from '../support/clients.js';
import {
  expectNotInOrderRoom,
  failure,
  orderStatusFor,
  QA_NOW_MS,
  startQaServer,
} from '../support/qa-harness.js';
import type { QaServer } from '../support/qa-harness.js';
import { JOIN_RATE_LIMIT } from '../../src/config/constants.js';
import { ORDER_ID, ORDER_ROOM, signRoomToken, STORE_ROOM } from '../support/tokens.js';

let qa: QaServer | undefined;

afterEach(async () => {
  await qa?.close();
  qa = undefined;
});

/** Karisik 10 deneme: basarili, hatali ve reddedilen; hepsi sayilir. */
async function useUpTheWindow(socket: Parameters<typeof joinRoom>[0]): Promise<void> {
  const payloads = [
    { room: STORE_ROOM },
    { room: 'admin:x' },
    { room: ORDER_ROOM },
    { room: ORDER_ROOM, token: 'bozuk.jeton.metni' },
  ];
  for (let attempt = 0; attempt < JOIN_RATE_LIMIT.MAX_ATTEMPTS; attempt += 1) {
    await joinRoom(socket, payloads[attempt % payloads.length]);
  }
}

describe('room.join siniri', () => {
  it('QA-RT-50: karisik 10 denemeden sonra GECERLI jetonlu 11. deneme RATE_LIMITED ve odaya alinmaz', async () => {
    qa = await startQaServer();
    const socket = await qa.client();
    await useUpTheWindow(socket);

    await expect(
      joinRoom(socket, { room: ORDER_ROOM, token: await signRoomToken(QA_NOW_MS) }),
    ).resolves.toEqual(failure('RATE_LIMITED'));
    await expectNotInOrderRoom(qa, socket, ORDER_ID);
  });

  it('QA-RT-50b: beklemeden ayni anda gonderilen 15 denemenin tam 10 tanesi sinirdan gecer', async () => {
    qa = await startQaServer();
    const socket = await qa.client();
    const extra = 5;

    const acks = await Promise.all(
      Array.from({ length: JOIN_RATE_LIMIT.MAX_ATTEMPTS + extra }, () =>
        joinRoom(socket, { room: STORE_ROOM }),
      ),
    );

    const limited = acks.filter((ack) => JSON.stringify(ack).includes('"RATE_LIMITED"'));
    expect(limited).toHaveLength(extra);
    expect(acks.length - limited.length).toBe(JOIN_RATE_LIMIT.MAX_ATTEMPTS);
  });

  it('QA-RT-51: pencere (10 sn) gecince ayni soket yeniden katilabilir', async () => {
    qa = await startQaServer();
    const socket = await qa.client();
    await useUpTheWindow(socket);
    await expect(joinRoom(socket, { room: STORE_ROOM })).resolves.toEqual(failure('RATE_LIMITED'));

    qa.clock.advance(JOIN_RATE_LIMIT.WINDOW_MS);
    const token = await signRoomToken(qa.clock.now());

    await expect(joinRoom(socket, { room: ORDER_ROOM, token })).resolves.toEqual({
      success: true,
      data: { room: ORDER_ROOM },
    });
    const received = nextEvent(socket, SOCKET_EVENTS.ORDER_STATUS);
    qa.server.broadcast(ORDER_ROOM, 'order.status', orderStatusFor(ORDER_ID));
    await expect(received).resolves.toEqual(orderStatusFor(ORDER_ID));
  });

  it('QA-RT-53: sinira dayanan soket, ayni sunucudaki baska soketi etkilemez', async () => {
    qa = await startQaServer();
    const [noisy, quiet] = await Promise.all([qa.client(), qa.client()]);
    await useUpTheWindow(noisy);
    await expect(joinRoom(noisy, { room: STORE_ROOM })).resolves.toEqual(failure('RATE_LIMITED'));

    await expect(
      joinRoom(quiet, { room: ORDER_ROOM, token: await signRoomToken(QA_NOW_MS) }),
    ).resolves.toEqual({
      success: true,
      data: { room: ORDER_ROOM },
    });
  });
});
