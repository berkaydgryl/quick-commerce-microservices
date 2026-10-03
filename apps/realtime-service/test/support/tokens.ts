/**
 * Test oda jetonlari: gateway'in imzaladigi jetonun aynisi (REALTIME_TOKEN
 * sabitleri) ve her alani ayri ayri bozulabilen cesitleri.
 */

import { REALTIME_TOKEN } from '@getir/contracts';
import { SignJWT } from 'jose';

export const TEST_SECRET = 'yalnizca-test-icin-oda-jetonu-sirri-32-bayttan-uzun';
export const OTHER_SECRET = 'baska-bir-sir-ornegin-erisim-jetonunun-sirri-32-bayt';

export const USER_ID = 'usr_0123456789abcdef0123456789abcdef';
export const ORDER_ID = 'ord_0123456789abcdef0123456789abcdef';
export const OTHER_ORDER_ID = 'ord_fedcba9876543210fedcba9876543210';
export const MARKET_ID = 'mkt_migros-jet-moda';

export const ORDER_ROOM = `order:${ORDER_ID}`;
export const OTHER_ORDER_ROOM = `order:${OTHER_ORDER_ID}`;
export const STORE_ROOM = `store:${MARKET_ID}`;

export interface TokenOverrides {
  readonly secret?: string;
  readonly algorithm?: string;
  readonly issuer?: string | null;
  readonly audience?: string | null;
  readonly subject?: string | null;
  readonly room?: string | null;
  /** Imza aninin epoch saniyesi; verilmezse `now`. */
  readonly issuedAt?: number | null;
  /** Omur (sn); null: exp yazilmaz. */
  readonly ttlSeconds?: number | null;
  /** nbf (epoch sn); verilmezse yazilmaz (gateway yazmaz). */
  readonly notBefore?: number;
}

/** Varsayilanlariyla gecerli bir oda jetonu; her alan ayri ayri degistirilebilir. */
export async function signRoomToken(
  nowMs: number,
  overrides: TokenOverrides = {},
): Promise<string> {
  const issuedAt = overrides.issuedAt === undefined ? Math.floor(nowMs / 1000) : overrides.issuedAt;
  const ttl =
    overrides.ttlSeconds === undefined ? REALTIME_TOKEN.TTL_SECONDS : overrides.ttlSeconds;
  const room = overrides.room === undefined ? ORDER_ROOM : overrides.room;
  const jwt = new SignJWT(
    room === null ? {} : { [REALTIME_TOKEN.ROOM_CLAIM]: room },
  ).setProtectedHeader({
    alg: overrides.algorithm ?? REALTIME_TOKEN.ALGORITHM,
  });
  const issuer = overrides.issuer === undefined ? REALTIME_TOKEN.ISSUER : overrides.issuer;
  const audience = overrides.audience === undefined ? REALTIME_TOKEN.AUDIENCE : overrides.audience;
  const subject = overrides.subject === undefined ? USER_ID : overrides.subject;
  if (issuer !== null) {
    jwt.setIssuer(issuer);
  }
  if (audience !== null) {
    jwt.setAudience(audience);
  }
  if (subject !== null) {
    jwt.setSubject(subject);
  }
  if (issuedAt !== null) {
    jwt.setIssuedAt(issuedAt);
  }
  if (overrides.notBefore !== undefined) {
    jwt.setNotBefore(overrides.notBefore);
  }
  if (ttl !== null) {
    jwt.setExpirationTime((issuedAt ?? Math.floor(nowMs / 1000)) + ttl);
  }
  return jwt.sign(new TextEncoder().encode(overrides.secret ?? TEST_SECRET));
}

/** Imzasiz ("alg: none") jeton: jose uretmez, elle kurulur. */
export function unsignedToken(nowMs: number): string {
  const encode = (value: object): string =>
    Buffer.from(JSON.stringify(value)).toString('base64url');
  const iat = Math.floor(nowMs / 1000);
  return `${encode({ alg: 'none', typ: 'JWT' })}.${encode({
    iss: REALTIME_TOKEN.ISSUER,
    aud: REALTIME_TOKEN.AUDIENCE,
    sub: USER_ID,
    [REALTIME_TOKEN.ROOM_CLAIM]: ORDER_ROOM,
    iat,
    exp: iat + REALTIME_TOKEN.TTL_SECONDS,
  })}.`;
}
