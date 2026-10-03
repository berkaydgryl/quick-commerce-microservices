/**
 * room.join (T12.1 + T12.2): istemcinin odaya katilma istegi.
 *
 * Sira bilerek boyle:
 *  1. Sinir (D8): sayac her denemede, gecersiz govde de dahil, ilerler; boylece
 *     bozuk paket gondererek sinir atlatilamaz.
 *  2. Govde (contracts roomJoinPayloadSchema; oda adi bicimli kimlik tasir).
 *     Metin olmayan jeton VALIDATION_FAILED'dir.
 *  3. Yalnizca siparis odasinda jeton dogrulanir; market odasina gelen jeton
 *     yok sayilir. Bos metin jeton "jetonsuz" sayilir (FORBIDDEN, UNAUTHORIZED degil).
 *  4. Yetki karari domain'de (decideRoomAccess).
 *
 * Use-case Socket.io'yu bilmez: katilmanin kendisini (socket.join) cagiran yapar.
 */

import { roomJoinPayloadSchema } from '@getir/contracts';
import type { ErrorCode } from '@getir/core';

import { decideRoomAccess, JOIN_REJECTION, REJECTION_CODES } from '../domain/room-access.js';
import type { JoinRejection, RoomGrant, TokenCheck } from '../domain/room-access.js';
import { parseRoom, ROOM_KINDS } from '../domain/room.js';
import type { Room } from '../domain/room.js';
import type { JoinRateLimiter } from './join-rate-limit.js';

/** Oda jetonunu dogrulayan port (altyapi: jose). */
export interface RoomTokenVerifier {
  /** Hata firlatmaz: gecersiz jeton `invalid`, sir yoksa `disabled` doner. */
  verify(token: string): Promise<Exclude<TokenCheck, { status: 'absent' }>>;
}

export interface JoinRoomDeps {
  readonly verifier: RoomTokenVerifier;
}

export interface JoinRoomRequest {
  /** Istemcinin gonderdigi ham govde; dogrulanmamis. */
  readonly payload: unknown;
  /** Bu soketin sayaci. */
  readonly limiter: JoinRateLimiter;
}

export type JoinRoomResult =
  | { readonly ok: true; readonly room: Room; readonly grant?: RoomGrant }
  | {
      readonly ok: false;
      readonly rejection: JoinRejection;
      readonly code: ErrorCode;
      /** Oda ayristirildiysa (gunluk ve metrik etiketi icin). */
      readonly room?: Room;
      /** Jeton neden gecersiz (gunluk icin; istemciye gitmez). */
      readonly reason?: string;
    };

export type JoinRoom = (request: JoinRoomRequest) => Promise<JoinRoomResult>;

export function createJoinRoom(deps: JoinRoomDeps): JoinRoom {
  return async ({ payload, limiter }) => {
    if (!limiter.tryAcquire()) {
      return reject(JOIN_REJECTION.RATE_LIMITED);
    }
    const parsed = roomJoinPayloadSchema.safeParse(payload);
    if (!parsed.success) {
      return reject(JOIN_REJECTION.INVALID_PAYLOAD);
    }
    // Sema adi zaten dogruladi; ayristirma turu ve kimligi ayirir.
    const room = parseRoom(parsed.data.room);
    if (room === undefined) {
      return reject(JOIN_REJECTION.INVALID_PAYLOAD);
    }

    const token = parsed.data.token;
    const check: TokenCheck =
      room.kind === ROOM_KINDS.ORDER && token !== undefined && token !== ''
        ? await deps.verifier.verify(token)
        : { status: 'absent' };
    const decision = decideRoomAccess(room, check);
    if (!decision.allowed) {
      return reject(
        decision.rejection,
        room,
        check.status === 'invalid' ? check.reason : undefined,
      );
    }
    return decision.grant === undefined
      ? { ok: true, room }
      : { ok: true, room, grant: decision.grant };
  };
}

function reject(rejection: JoinRejection, room?: Room, reason?: string): JoinRoomResult {
  return {
    ok: false,
    rejection,
    code: REJECTION_CODES[rejection],
    ...(room === undefined ? {} : { room }),
    ...(reason === undefined ? {} : { reason }),
  };
}
