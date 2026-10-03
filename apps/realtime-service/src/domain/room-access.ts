/**
 * Oda yetkisi (T12.2, B28): kim hangi odaya girebilir?
 *
 *  - store:* herkese acik; jeton istenmez, verilse de bakilmaz.
 *  - order:* icin dogrulanmis bir oda jetonu SART ve jetonun odasi istenen odayla
 *    AYNI olmali: bir siparisin jetonu baska siparisin odasini acmaz.
 *
 * Jetonun kendisi (imza, sure, alici) altyapida dogrulanir; buraya yalnizca
 * sonucu gelir. Yetki yalnizca KATILIMDA denetlenir: odadaki soket, jetonun
 * suresi dolunca odadan atilmaz (socket-events.md).
 */

import { ERROR_CODES } from '@getir/core';
import type { ErrorCode } from '@getir/core';

import { ROOM_KINDS } from './room.js';
import type { Room } from './room.js';

/** Dogrulanmis oda jetonunun tasidigi yetki. */
export interface RoomGrant {
  /** Jetonun sahibi (sub); yalnizca gunluk ve iz icin. */
  readonly userId: string;
  /** Jetonun yetkili oldugu tek oda (order:{orderId}). */
  readonly room: string;
}

/** Jeton denetiminin sonucu. */
export type TokenCheck =
  | { readonly status: 'absent' }
  /** Bu kopyada sir yok (yalnizca MOCK): siparis odalari kapali (D3). */
  | { readonly status: 'disabled' }
  /** `reason`: neden gecersiz (gunluk icin; istemciye gitmez). */
  | { readonly status: 'invalid'; readonly reason: string }
  | { readonly status: 'valid'; readonly grant: RoomGrant };

/**
 * Reddin gerekcesi: gunlukte ve izde okunur. KAPALI kume; istemciye yalnizca
 * karsilik gelen hata kodu gider (gerekce saldirgana ipucu vermesin).
 */
export const JOIN_REJECTION = {
  /** Govde ya da oda adi sozlesmeye uymuyor (contracts roomJoinPayloadSchema). */
  INVALID_PAYLOAD: 'invalid_payload',
  RATE_LIMITED: 'rate_limited',
  TOKEN_MISSING: 'token_missing',
  TOKEN_INVALID: 'token_invalid',
  TOKEN_ROOM_MISMATCH: 'token_room_mismatch',
  ORDER_ROOMS_DISABLED: 'order_rooms_disabled',
} as const;

export type JoinRejection = (typeof JOIN_REJECTION)[keyof typeof JOIN_REJECTION];

/** Gerekce -> istemcinin gordugu hata kodu (socket-events.md "Hata kodlari"). */
export const REJECTION_CODES: Readonly<Record<JoinRejection, ErrorCode>> = {
  [JOIN_REJECTION.INVALID_PAYLOAD]: ERROR_CODES.VALIDATION_FAILED,
  [JOIN_REJECTION.RATE_LIMITED]: ERROR_CODES.RATE_LIMITED,
  // Jetonsuz siparis odasi: kimlik bile sunulmadi -> yetki yok.
  [JOIN_REJECTION.TOKEN_MISSING]: ERROR_CODES.FORBIDDEN,
  // Bozuk, suresi dolmus ya da baska odanin jetonu: sunulan kimlik gecersiz.
  [JOIN_REJECTION.TOKEN_INVALID]: ERROR_CODES.UNAUTHORIZED,
  [JOIN_REJECTION.TOKEN_ROOM_MISMATCH]: ERROR_CODES.UNAUTHORIZED,
  [JOIN_REJECTION.ORDER_ROOMS_DISABLED]: ERROR_CODES.SERVICE_UNAVAILABLE,
};

export type AccessDecision =
  | { readonly allowed: true; readonly grant?: RoomGrant }
  | { readonly allowed: false; readonly rejection: JoinRejection };

/** Odaya giris kurali; saf fonksiyon. */
export function decideRoomAccess(room: Room, token: TokenCheck): AccessDecision {
  if (room.kind === ROOM_KINDS.STORE) {
    return { allowed: true };
  }
  switch (token.status) {
    case 'absent':
      return { allowed: false, rejection: JOIN_REJECTION.TOKEN_MISSING };
    case 'disabled':
      return { allowed: false, rejection: JOIN_REJECTION.ORDER_ROOMS_DISABLED };
    case 'invalid':
      return { allowed: false, rejection: JOIN_REJECTION.TOKEN_INVALID };
    case 'valid':
      return token.grant.room === room.name
        ? { allowed: true, grant: token.grant }
        : { allowed: false, rejection: JOIN_REJECTION.TOKEN_ROOM_MISMATCH };
  }
}
