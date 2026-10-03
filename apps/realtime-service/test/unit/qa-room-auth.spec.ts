/**
 * QA kara kutu: siparis odasinin yetkisi (T12.2; docs/api/socket-events.md
 * "Oda jetonu" ve "room.join nasil karar verir"). Belgedeki her jeton kurali tel
 * uzerinden, gercek istemciyle denenir; her redden sonra soketin odaya ALINMADIGI
 * yayinla kanitlanir (ack'in "hata" demesi yetmez).
 *
 * Backend'in testlerinde olanlar (alg:none, bos jeton, baska odanin jetonu, pay
 * icinde suresi gecmis jeton, iat/nbf gelecekte, omur > 60 sn, tekrar kullanim)
 * burada yinelenmez.
 */

import { REALTIME_TOKEN, SOCKET_EVENTS } from '@getir/contracts';
import { generateKeyPair } from 'jose';
import { afterEach, describe, expect, it } from 'vitest';

import { joinRoom, nextEvent } from '../support/clients.js';
import {
  expectNotInOrderRoom,
  failure,
  orderStatusFor,
  QA_NOW_SECONDS,
  signClaims,
  startQaServer,
} from '../support/qa-harness.js';
import type { QaServer } from '../support/qa-harness.js';
import {
  ORDER_ID,
  ORDER_ROOM,
  OTHER_SECRET,
  signRoomToken,
  STORE_ROOM,
  USER_ID,
} from '../support/tokens.js';

/** Belgedeki saat payi (socket-events.md "Saat payi 5 sn"). */
const CLOCK_TOLERANCE_SECONDS = 5;

/** Gateway'in oda jetonu govdesi (roomtoken.Sign): tek alan bozulacak taban. */
const validClaims = () => ({
  iss: REALTIME_TOKEN.ISSUER,
  aud: REALTIME_TOKEN.AUDIENCE,
  sub: USER_ID,
  [REALTIME_TOKEN.ROOM_CLAIM]: ORDER_ROOM,
  iat: QA_NOW_SECONDS,
  exp: QA_NOW_SECONDS + REALTIME_TOKEN.TTL_SECONDS,
});

/** Verilen alanlari govdeden cikarir (eksik alan senaryolari). */
function without(...names: string[]) {
  const claims: Record<string, unknown> = validClaims();
  for (const name of names) {
    delete claims[name];
  }
  return claims;
}

let qa: QaServer | undefined;

afterEach(async () => {
  await qa?.close();
  qa = undefined;
});

async function rejectsWith(
  token: unknown,
  code: 'UNAUTHORIZED' | 'VALIDATION_FAILED' | 'FORBIDDEN',
) {
  qa = await startQaServer();
  const socket = await qa.client();

  await expect(joinRoom(socket, { room: ORDER_ROOM, token })).resolves.toEqual(failure(code));
  await expectNotInOrderRoom(qa, socket, ORDER_ID);
}

describe('oda jetonu: imza ve algoritma', () => {
  it('QA-RT-14: baska sirla imzali jeton UNAUTHORIZED, odaya alinmaz', async () => {
    await rejectsWith(
      await signClaims({ claims: validClaims(), key: OTHER_SECRET }),
      'UNAUTHORIZED',
    );
  });

  it('QA-RT-15a: ayni sirla HS512 imzali jeton UNAUTHORIZED (yalnizca HS256)', async () => {
    await rejectsWith(
      await signRoomToken(QA_NOW_SECONDS * 1000, { algorithm: 'HS512' }),
      'UNAUTHORIZED',
    );
  });

  it('QA-RT-15b: RS256 imzali jeton UNAUTHORIZED (algoritma karistirma)', async () => {
    const { privateKey } = await generateKeyPair('RS256');
    const token = await signClaims({
      claims: validClaims(),
      header: { alg: 'RS256' },
      key: privateKey,
    });

    await rejectsWith(token, 'UNAUTHORIZED');
  });
});

describe('oda jetonu: verici, alici ve konu', () => {
  it.each([
    ['QA-RT-16a: yanlis iss', { ...validClaims(), iss: 'baska-verici' }],
    ['QA-RT-16b: yanlis aud', { ...validClaims(), aud: 'gateway' }],
    ['QA-RT-16c: aud yok', without('aud')],
    ['QA-RT-18a: sub yok', without('sub')],
    [
      'QA-RT-18b: sub usr_ bicimi disi',
      { ...validClaims(), sub: 'ord_0123456789abcdef0123456789abcdef' },
    ],
    ['QA-RT-19a: room alani yok', without(REALTIME_TOKEN.ROOM_CLAIM)],
    [
      'QA-RT-19b: room alani market odasi',
      { ...validClaims(), [REALTIME_TOKEN.ROOM_CLAIM]: STORE_ROOM },
    ],
    [
      'QA-RT-19c: room alani bicimsiz siparis odasi',
      { ...validClaims(), [REALTIME_TOKEN.ROOM_CLAIM]: 'order:copluk' },
    ],
    ['QA-RT-22b: exp yok', without('exp')],
    ['QA-RT-22c: iat yok', without('iat')],
  ])('%s -> UNAUTHORIZED, odaya alinmaz', async (_name, claims) => {
    await rejectsWith(await signClaims({ claims }), 'UNAUTHORIZED');
  });
});

describe('oda jetonu: erisim jetonu yerine gecmez (QA-RT-17)', () => {
  /** Gateway erisim jetonunun govdesi (auth/token.go accessClaims): sub + sid, aud ve room yok. */
  const accessClaims = () => ({
    iss: REALTIME_TOKEN.ISSUER,
    sub: USER_ID,
    sid: 'ses_0123456789abcdef0123456789abcdef',
    iat: QA_NOW_SECONDS,
    exp: QA_NOW_SECONDS + REALTIME_TOKEN.TTL_SECONDS,
  });

  it('QA-RT-17a: erisim jetonu kendi sirriyla (JWT_SECRET) imzali -> UNAUTHORIZED', async () => {
    await rejectsWith(
      await signClaims({ claims: accessClaims(), key: OTHER_SECRET }),
      'UNAUTHORIZED',
    );
  });

  it('QA-RT-17b: erisim jetonu bicimi realtime sirriyla imzali olsa da -> UNAUTHORIZED (aud denetimi sirdan bagimsiz)', async () => {
    await rejectsWith(await signClaims({ claims: accessClaims() }), 'UNAUTHORIZED');
  });
});

describe('oda jetonu: sure siniri (QA-RT-13)', () => {
  it('exp saat payinin otesinde gecmisse UNAUTHORIZED, odaya alinmaz', async () => {
    const expired = {
      ...validClaims(),
      iat: QA_NOW_SECONDS - REALTIME_TOKEN.TTL_SECONDS - CLOCK_TOLERANCE_SECONDS - 1,
      exp: QA_NOW_SECONDS - CLOCK_TOLERANCE_SECONDS - 1,
    };

    await rejectsWith(await signClaims({ claims: expired }), 'UNAUTHORIZED');
  });
});

describe('jetonun turu (QA-RT-20b; belge: "metin olmayan token -> VALIDATION_FAILED")', () => {
  it.each([
    ['sayi', 123],
    ['nesne', {}],
    ['null', null],
    ['dizi', []],
  ])('siparis odasinda jeton %s ise VALIDATION_FAILED', async (_name, token) => {
    await rejectsWith(token, 'VALIDATION_FAILED');
  });

  it('market odasinda da metin olmayan jeton VALIDATION_FAILED (govde denetimi market kuralindan once)', async () => {
    qa = await startQaServer();
    const socket = await qa.client();

    await expect(joinRoom(socket, { room: STORE_ROOM, token: 123 })).resolves.toEqual(
      failure('VALIDATION_FAILED'),
    );
  });
});

describe('yetki yalnizca katilimda denetlenir (QA-RT-24)', () => {
  it('katildiktan sonra jetonun suresi dolsa da soket odada kalir ve olay almaya devam eder', async () => {
    qa = await startQaServer();
    const owner = await qa.client();
    await expect(
      joinRoom(owner, { room: ORDER_ROOM, token: await signClaims({ claims: validClaims() }) }),
    ).resolves.toEqual({ success: true, data: { room: ORDER_ROOM } });

    qa.clock.advance(2 * REALTIME_TOKEN.TTL_SECONDS * 1000);
    const received = nextEvent(owner, SOCKET_EVENTS.ORDER_STATUS);
    qa.server.broadcast(ORDER_ROOM, 'order.status', orderStatusFor(ORDER_ID));

    await expect(received).resolves.toEqual(orderStatusFor(ORDER_ID));
  });

  it('ayni (artik suresi dolmus) jetonla yeni soket katilamaz: UNAUTHORIZED', async () => {
    qa = await startQaServer();
    const token = await signClaims({ claims: validClaims() });
    const first = await qa.client();
    await joinRoom(first, { room: ORDER_ROOM, token });

    qa.clock.advance(2 * REALTIME_TOKEN.TTL_SECONDS * 1000);
    const second = await qa.client();

    await expect(joinRoom(second, { room: ORDER_ROOM, token })).resolves.toEqual(
      failure('UNAUTHORIZED'),
    );
    await expectNotInOrderRoom(qa, second, ORDER_ID);
  });
});
