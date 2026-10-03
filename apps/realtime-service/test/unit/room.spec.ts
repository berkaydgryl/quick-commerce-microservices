import { describe, expect, it } from 'vitest';

import { decideRoomAccess, JOIN_REJECTION, REJECTION_CODES } from '../../src/domain/room-access.js';
import type { TokenCheck } from '../../src/domain/room-access.js';
import { parseRoom, ROOM_KINDS } from '../../src/domain/room.js';
import {
  MARKET_ID,
  ORDER_ID,
  ORDER_ROOM,
  OTHER_ORDER_ROOM,
  STORE_ROOM,
  USER_ID,
} from '../support/tokens.js';

describe('parseRoom', () => {
  it('siparis odasini ayristirir', () => {
    expect(parseRoom(ORDER_ROOM)).toEqual({
      kind: ROOM_KINDS.ORDER,
      name: ORDER_ROOM,
      orderId: ORDER_ID,
    });
  });

  it('market odasini ayristirir', () => {
    expect(parseRoom(STORE_ROOM)).toEqual({
      kind: ROOM_KINDS.STORE,
      name: STORE_ROOM,
      marketId: MARKET_ID,
    });
  });

  it.each([
    ['onek yok', ORDER_ID],
    ['bilinmeyen onek', `courier:${ORDER_ID}`],
    ['siparis kimligi bicim disi', 'order:123'],
    ['siparis kimligi baska onekli', 'order:usr_0123456789abcdef0123456789abcdef'],
    ['siparis kimligi buyuk harfli', 'order:ord_0123456789ABCDEF0123456789ABCDEF'],
    ['siparis odasinda ek parca', `${ORDER_ROOM}:x`],
    ['market kimligi bicim disi', 'store:../../etc'],
    ['market kimligi baska onekli', 'store:prd_sut-1l'],
    ['bos market', 'store:'],
    ['bos', ''],
  ])('%s ise odayi reddeder', (_name, name) => {
    expect(parseRoom(name)).toBeUndefined();
  });
});

describe('decideRoomAccess', () => {
  const order = parseRoom(ORDER_ROOM);
  const store = parseRoom(STORE_ROOM);
  if (order === undefined || store === undefined) {
    throw new Error('test odalari ayristirilamadi');
  }
  const valid = (room: string): TokenCheck => ({
    status: 'valid',
    grant: { userId: USER_ID, room },
  });

  it.each<[string, TokenCheck]>([
    ['jetonsuz', { status: 'absent' }],
    ['gecersiz jetonla', { status: 'invalid', reason: 'x' }],
    ['sirsiz kopyada', { status: 'disabled' }],
  ])('market odasi %s da aciktir', (_name, token) => {
    expect(decideRoomAccess(store, token)).toEqual({ allowed: true });
  });

  it('siparis odasina kendi jetonuyla girilir', () => {
    expect(decideRoomAccess(order, valid(ORDER_ROOM))).toEqual({
      allowed: true,
      grant: { userId: USER_ID, room: ORDER_ROOM },
    });
  });

  it.each<[string, TokenCheck, string]>([
    ['jetonsuz', { status: 'absent' }, JOIN_REJECTION.TOKEN_MISSING],
    ['gecersiz jetonla', { status: 'invalid', reason: 'x' }, JOIN_REJECTION.TOKEN_INVALID],
    ['baska siparisin jetonuyla', valid(OTHER_ORDER_ROOM), JOIN_REJECTION.TOKEN_ROOM_MISMATCH],
    ['sirsiz kopyada', { status: 'disabled' }, JOIN_REJECTION.ORDER_ROOMS_DISABLED],
  ])('siparis odasina %s girilmez', (_name, token, rejection) => {
    expect(decideRoomAccess(order, token)).toEqual({ allowed: false, rejection });
  });

  it('gerekceler sozlesmedeki hata kodlarina eslenir', () => {
    expect(REJECTION_CODES).toEqual({
      invalid_payload: 'VALIDATION_FAILED',
      rate_limited: 'RATE_LIMITED',
      token_missing: 'FORBIDDEN',
      token_invalid: 'UNAUTHORIZED',
      token_room_mismatch: 'UNAUTHORIZED',
      order_rooms_disabled: 'SERVICE_UNAVAILABLE',
    });
  });
});
