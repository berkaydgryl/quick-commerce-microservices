/**
 * Oda jetonu dogrulamasi (T12.2, K2): gateway'in imzaladigi kisa omurlu JWT.
 *
 * Realtime jetonu KENDISI dogrular, gRPC cagrisi yapmaz (siparisin sahibini
 * gateway jetonu verirken denetledi). Denetlenenler:
 *  - algoritma YALNIZCA HS256 ("alg: none", HS512, RS256 reddedilir; algoritma
 *    karistirma saldirisi),
 *  - imza (REALTIME_TOKEN_SECRET; erisim jetonunun sirri DEGIL),
 *  - iss = getir-gateway, aud = realtime: erisim jetonunda aud yoktur, bu yuzden
 *    ayni sirla imzalansa bile oda jetonu yerine gecemez,
 *  - exp ve iat ZORUNLU. Jetonun omru (exp - iat) TTL'i asamaz ve iat'ten bu
 *    yana TTL + saat payindan fazla gecemez: sizan bir sirla uzun omurlu jeton
 *    uretilse bile kabul edilmez. iat ya da nbf gelecekteyse (pay disinda) red,
 *  - jti YOKTUR: ayni jeton omru icinde birden cok sokette kullanilabilir
 *    (yalnizca ayni odaya; socket-events.md),
 *  - sub bicimli kullanici kimligi, room bir siparis odasi.
 *
 * Kutuphane jose: bagimliliksiz, Web Crypto ile calisir ve HS256'yi algoritma
 * listesiyle sinirlamayi zorunlu kilar.
 */

import { REALTIME_TOKEN, ROOM_PREFIX } from '@getir/contracts';
import { ID_PREFIX, isId } from '@getir/core';
import type { Clock } from '@getir/core';
import { errors, jwtVerify } from 'jose';
import type { JWTPayload } from 'jose';

import { TOKEN_CLOCK_TOLERANCE_SECONDS } from '../config/constants.js';
import type { RoomTokenVerifier } from '../application/join-room.js';

/** Imza ve bicim disinda kalan red gerekceleri (gunluk icin). */
export const TOKEN_INVALID_REASON = {
  /** Kutuphanenin tanimadigi bir hata; ayrintisi gunluge yazilmaz. */
  UNKNOWN: 'unknown',
  /** sub ya da room bicim disi. */
  CLAIMS: 'claims',
  /** exp - iat, TTL'den uzun. */
  LIFETIME: 'lifetime',
} as const;

export interface RoomTokenVerifierOptions {
  /** REALTIME_TOKEN_SECRET; gateway'in imzaladigi degerle ayni olmali. */
  readonly secret: string;
  readonly clock: Clock;
}

/** Sirla dogrulayan uygulama. */
export function createRoomTokenVerifier(options: RoomTokenVerifierOptions): RoomTokenVerifier {
  const key = new TextEncoder().encode(options.secret);

  return {
    verify: async (token) => {
      try {
        const { payload } = await jwtVerify(token, key, {
          algorithms: [REALTIME_TOKEN.ALGORITHM],
          issuer: REALTIME_TOKEN.ISSUER,
          audience: REALTIME_TOKEN.AUDIENCE,
          requiredClaims: ['exp', 'iat', 'sub', REALTIME_TOKEN.ROOM_CLAIM],
          // jose saat payini bu sinira da ekler: en fazla TTL + pay saniyelik jeton.
          maxTokenAge: REALTIME_TOKEN.TTL_SECONDS,
          clockTolerance: TOKEN_CLOCK_TOLERANCE_SECONDS,
          currentDate: options.clock.date(),
        });
        if (lifetimeOf(payload) > REALTIME_TOKEN.TTL_SECONDS) {
          return { status: 'invalid', reason: TOKEN_INVALID_REASON.LIFETIME };
        }
        const room = payload[REALTIME_TOKEN.ROOM_CLAIM];
        if (
          !isId(ID_PREFIX.USER, payload.sub) ||
          typeof room !== 'string' ||
          !room.startsWith(ROOM_PREFIX.order)
        ) {
          return { status: 'invalid', reason: TOKEN_INVALID_REASON.CLAIMS };
        }
        return { status: 'valid', grant: { userId: payload.sub, room } };
      } catch (error: unknown) {
        // jose'nin hata kodu (ERR_JWT_EXPIRED, ERR_JWS_SIGNATURE_VERIFICATION_FAILED...)
        // kapali bir kumedir ve jetonun icerigini tasimaz; gunluk icin yeterli.
        return { status: 'invalid', reason: reasonOf(error) };
      }
    },
  };
}

/** Sir verilmemis kopya (yalnizca MOCK, D3): siparis odalari kapali. */
export const disabledRoomTokenVerifier: RoomTokenVerifier = {
  verify: () => Promise.resolve({ status: 'disabled' }),
};

/** exp ve iat zorunlu oldugu icin (requiredClaims) ikisi de sayidir; degilse sonsuz. */
function lifetimeOf(payload: JWTPayload): number {
  return typeof payload.exp === 'number' && typeof payload.iat === 'number'
    ? payload.exp - payload.iat
    : Number.POSITIVE_INFINITY;
}

function reasonOf(error: unknown): string {
  return error instanceof errors.JOSEError ? error.code : TOKEN_INVALID_REASON.UNKNOWN;
}
