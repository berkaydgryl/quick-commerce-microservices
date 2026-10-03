/**
 * Diller arasi uyum (QA-RT-L1g, T12.2): gateway'in Go ile imzaladigi jeton,
 * realtime'in Node'daki GERCEK dogrulayicisindan gecer mi?
 *
 * Jeton elle ya da jose ile uretilmez: packages/contracts/test/fixtures altindaki
 * altin dosyada, gateway'in roomtoken.Signer'inin sabit saat ve sirla urettigi
 * metin durur. Go tarafi (apps/gateway/internal/roomtoken/golden_qa_test.go)
 * Signer'in hala BIREBIR bu metni urettigini denetler; bu test ayni metni
 * realtime'a verir. Biri kirilirsa iki dil ayni jetonda bulusmuyor demektir.
 */

import { readFileSync } from 'node:fs';

import { REALTIME_TOKEN, realtimeTokenSchema } from '@getir/contracts';
import { fixedClock } from '@getir/core';
import { z } from 'zod';
import { describe, expect, it } from 'vitest';

import { createRoomTokenVerifier } from '../../src/infrastructure/room-token-verifier.js';
import { TOKEN_CLOCK_TOLERANCE_SECONDS } from '../../src/config/constants.js';

const GOLDEN_PATH = new URL(
  '../../../../packages/contracts/test/fixtures/gateway-room-token.golden.json',
  import.meta.url,
);

const goldenSchema = realtimeTokenSchema.extend({
  secret: z.string().min(1),
  userId: z.string(),
  orderId: z.string(),
  signedAt: z.string().datetime(),
});

const golden = goldenSchema.parse(JSON.parse(readFileSync(GOLDEN_PATH, 'utf8')));

/** Go, imza anini saniyeye kirpar (roomtoken.Sign); iat bu andir. */
const issuedAtMs = Math.floor(Date.parse(golden.signedAt) / 1000) * 1000;

function verifierAt(epochMs: number) {
  return createRoomTokenVerifier({ secret: golden.secret, clock: fixedClock(epochMs) });
}

describe("gateway'in imzaladigi jeton (altin dosya)", () => {
  it('REST cevabinin bicimi sozlesmeye uyar: oda siparisin odasi, omur 60 sn', () => {
    expect(golden.room).toBe(`order:${golden.orderId}`);
    expect(golden.ttlSeconds).toBe(REALTIME_TOKEN.TTL_SECONDS);
    expect(Date.parse(golden.expiresAt)).toBe(issuedAtMs + REALTIME_TOKEN.TTL_SECONDS * 1000);
  });

  it("imza aninda realtime'in dogrulayicisindan gecer: sahibi ve odasi dogru", async () => {
    await expect(verifierAt(issuedAtMs).verify(golden.token)).resolves.toEqual({
      status: 'valid',
      grant: { userId: golden.userId, room: golden.room },
    });
  });

  // RFC 7519 4.1.4: exp anindan ITIBAREN kabul edilmez; pay bu ani 5 sn oteler.
  // Yani son kabul edilen saniye exp + 4, exp + 5 artik reddedilir.
  it('saat payinin son saniyesinde (exp + 4 sn) hala gecer', async () => {
    const lastAcceptedMs =
      Date.parse(golden.expiresAt) + (TOKEN_CLOCK_TOLERANCE_SECONDS - 1) * 1000;

    await expect(verifierAt(lastAcceptedMs).verify(golden.token)).resolves.toMatchObject({
      status: 'valid',
    });
  });

  it('exp + saat payi aninda reddedilir', async () => {
    const tooLateMs = Date.parse(golden.expiresAt) + TOKEN_CLOCK_TOLERANCE_SECONDS * 1000;

    await expect(verifierAt(tooLateMs).verify(golden.token)).resolves.toMatchObject({
      status: 'invalid',
    });
  });

  it('baska sirla dogrulanamaz (realtime yalnizca kendi sirrina guvenir)', async () => {
    const verifier = createRoomTokenVerifier({
      secret: `${golden.secret}-baska`,
      clock: fixedClock(issuedAtMs),
    });

    await expect(verifier.verify(golden.token)).resolves.toMatchObject({ status: 'invalid' });
  });
});
