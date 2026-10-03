/**
 * room.join ack govdesi: REST ile ayni zarf (contracts envelope.ts).
 *
 * Basarida `{ success: true, data: { room } }`, hatada `{ success: false,
 * error: { code, message, requestId } }`. Mesaj sozlukten gelir (toApiError);
 * reddin ic gerekcesi (jeton neden gecersiz) istemciye GITMEZ.
 */

import { apiFail, apiOk, toApiError } from '@getir/contracts';
import type { ApiErrorResponse, ApiSuccessResponse, RoomJoinResult } from '@getir/contracts';
import type { ErrorCode } from '@getir/core';

/** Istemcinin verdigi ack geri cagrisi. */
export type Ack = (body: ApiSuccessResponse<RoomJoinResult> | ApiErrorResponse) => void;

/** Istemci ack vermeden de gonderebilir; o zaman cevap yazilmaz. */
export function isAck(value: unknown): value is Ack {
  return typeof value === 'function';
}

export function joinedBody(room: string): ApiSuccessResponse<RoomJoinResult> {
  return apiOk({ room });
}

export function rejectedBody(code: ErrorCode, requestId: string): ApiErrorResponse {
  return apiFail(toApiError(code, requestId));
}
