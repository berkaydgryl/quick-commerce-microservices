/**
 * QA kara kutu (T15.2, risk geriye donuk PR 3; RQ3a): Evaluate ve GetLastEvaluation gRPC SINIRLARI
 * (payment PQ5, order OQ6 deseni). Gercek gRPC sunucusu (buildRiskService, uretimin startGrpcServer'i);
 * bellek deposu disaridan verilir ki kayit sayilsin. Her retten sonra: INVALID_ARGUMENT +
 * VALIDATION_FAILED, kayit YOK, hata metni ne gecersiz degeri ne de istegin diger metinlerini
 * (isaret) yankilar.
 *
 *   L1 zorunlu: baglam yok, kullanici bos ya da yalniz bosluk.
 *   L2 sayilar: siparis sayilari, dwell, cihazdaki hesap ve tutarlar -1'de ret, 0'da kabul.
 *   L3 konum: enlem +-90 ve boylam +-180 SINIRDA kabul, bir milyonda bir ustunde ret; NaN ve sonsuz
 *      ret (teslimat ve oturum konumu).
 *   L4 tel baytlariyla: Date araliginin disindaki hesap zamani ret; 2^53 ustu tutar istek cozulemeden
 *      INTERNAL (#147 sinifi), kayit yok. Ayni yoldan gecerli degerler kabul (kontrol).
 *   L5 MEVCUT ust sinir boslugu (#169): metin alanlarinda uzunluk siniri yok (64 KiB kimlikler
 *      kabul, kullanici kimligi kayda yazilir ve okunur). Tek sinir grpc-js'in 4 MiB mesaji; burada
 *      SINANMAZ: sunucunun okumayacagi veri gercek TCP'de gonderilmez (proje kurali, Linux titremesi).
 *      Uzunluk siniri eklenince bu test TERSINE doner.
 *   L6 GetLastEvaluation: kullanici zorunlu; kimlikler kirpilir; yalniz bosluk siparis "kullanicinin
 *      son degerlendirmesi" demektir (sahibin kendi kaydi); baskasinin siparisi ve olmayan siparis
 *      NOT_FOUND.
 */

import { ERROR_CODES, fixedClock, GRPC_STATUS } from '@getir/core';
import { riskV1 } from '@getir/proto';
import { appErrorOf, appErrorPayloadOf, startTestGrpcServer } from '@getir/service-kit/testing';
import type { CallResult, TestGrpcServer, UnaryCall } from '@getir/service-kit/testing';
import type { MethodDefinition } from '@grpc/grpc-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildRiskService } from '../../src/bootstrap.js';
import type { GeoPoint, RiskContext } from '../../src/domain/risk-context.js';
import { InMemoryRiskEventStore } from '../../src/infrastructure/memory/in-memory-risk-event-store.js';
import { toProtoContext } from '../support/proto-context.js';

const NOW = Date.parse('2026-10-07T12:00:00.000Z');
const DAY_MS = 24 * 60 * 60 * 1_000;
const MARK = 'QA-YANKI-ISARETI';
const LONG_TEXT_LENGTH = 64 * 1_024;

const store = new InMemoryRiskEventStore();
const clock = fixedClock(NOW);
let server: TestGrpcServer | undefined;
let users = 0;

beforeAll(async () => {
  server = await startTestGrpcServer({
    serviceName: 'qa-risk-sinirlar',
    services: [buildRiskService({ events: store, clock })],
  });
});

afterAll(async () => {
  await server?.stop();
});

const call: UnaryCall = (method, request, metadata) =>
  server === undefined
    ? Promise.reject(new Error('risk sunucusu yok'))
    : server.call(method, request, metadata);

/** Gecerli baglam; isaret yalniz serbest metin alanlarinda (yanki denetimi). */
function validContext(): RiskContext {
  users += 1;
  const serial = String(users).padStart(4, '0');
  return {
    userId: `usr_${'8'.repeat(28)}${serial}`,
    orderId: `ord_${'8'.repeat(28)}${serial}`,
    marketId: 'mkt_migros-jet-moda',
    accountCreatedAt: new Date(NOW - 30 * DAY_MS),
    deliveredOrderCount: 3,
    cancelledOrderCount: 0,
    basketTotalMinor: 7_990,
    userAverageBasketMinor: 8_000,
    checkoutDwellMs: 10_000,
    deliveryLocation: { lat: 40.99, lng: 29.02 },
    sessionLocation: { lat: 40.99, lng: 29.02 },
    ipAddress: '203.0.113.7',
    previousIpAddress: '203.0.113.7',
    ipCity: `sehir-${MARK}`,
    deviceId: `dev-${MARK}`,
    accountsOnDevice: 1,
  };
}

const evaluateWire = (context: riskV1.RiskContext | undefined) =>
  call(riskV1.RiskServiceService.evaluate, { context });

/** Gecerli baglam, tel uzerinde (proto) degistirilmis alanlarla. */
const evaluateWith = (change: Partial<riskV1.RiskContext>) =>
  evaluateWire({ ...toProtoContext(validContext()), ...change });

/** Hatanin istemciye giden butun metni: gRPC ayrintisi ve uygulama hatasi yuku (istek kimligi haric). */
function textOf(result: CallResult<unknown>): string {
  const { requestId: _requestId, ...payload } = appErrorPayloadOf(result.error) ?? {};
  return `${result.error?.details ?? ''} ${JSON.stringify(payload)}`;
}

/** Hata metni isareti ve verilen gecersiz degerleri yankilamaz. */
function expectNoEcho(result: CallResult<unknown>, echoes: readonly string[]): void {
  const text = textOf(result);
  for (const value of [MARK, ...echoes]) expect(text, value).not.toContain(value);
}

/** Ret: INVALID_ARGUMENT + VALIDATION_FAILED, kayit yok, yanki yok. */
async function expectRejected(
  send: () => Promise<CallResult<unknown>>,
  echoes: readonly string[] = [],
): Promise<void> {
  const before = store.size;
  const result = await send();
  expect([result.error?.code, appErrorOf(result.error)?.code, store.size - before]).toEqual([
    GRPC_STATUS.INVALID_ARGUMENT,
    ERROR_CODES.VALIDATION_FAILED,
    0,
  ]);
  expectNoEcho(result, echoes);
}

/** Kabul: karar doner, tek kayit yazilir. */
async function expectAccepted(send: () => Promise<CallResult<riskV1.EvaluateResponse>>) {
  const before = store.size;
  const result = await send();
  expect([
    result.error?.code,
    result.response?.evaluation === undefined,
    store.size - before,
  ]).toEqual([undefined, false, 1]);
  return result.response?.evaluation;
}

/** Protobuf varint (bigint: 2^53 ustu tam). */
function varint(value: bigint): number[] {
  const bytes: number[] = [];
  let rest = value;
  while (rest >= 0x80n) {
    bytes.push(Number(rest & 0x7fn) | 0x80);
    rest >>= 7n;
  }
  bytes.push(Number(rest));
  return bytes;
}

/** Uzunluklu alan (wire type 2): baslik, uzunluk, govde. */
const lengthDelimited = (field: number, body: readonly number[]): number[] => [
  (field << 3) | 2,
  ...varint(BigInt(body.length)),
  ...body,
];

/** Tek varint alanli mesaj (Timestamp.seconds = 1, Money.amount_minor = 1). */
const withFirstVarint = (field: number, value: bigint) =>
  lengthDelimited(field, [(1 << 3) | 0, ...varint(value)]);

/** Kodlanmis baglam + elle yazilmis alanlar: istemci kodlayicisinin uretemedigi degerler. */
function evaluateRaw(context: riskV1.RiskContext, extra: readonly number[]) {
  const method: MethodDefinition<Buffer, riskV1.EvaluateResponse> = {
    ...riskV1.RiskServiceService.evaluate,
    requestSerialize: (bytes: Buffer) => bytes,
    requestDeserialize: (bytes: Buffer) => bytes,
  };
  const encoded = [...riskV1.RiskContext.encode(context).finish(), ...extra];
  return call(method, Buffer.from(lengthDelimited(1, encoded)));
}

const FIELD = { ACCOUNT_CREATED_AT: 4, BASKET_TOTAL: 7 } as const;

describe('QA RQ3a risk gRPC sinirlari (Evaluate, GetLastEvaluation)', () => {
  it.each([
    ['baglam yok', undefined],
    ['kullanici bos', { ...toProtoContext(validContext()), userId: '' }],
    ['kullanici yalniz bosluk', { ...toProtoContext(validContext()), userId: ' \t\n ' }],
  ])('L1 zorunlu (%s): ret, kayit yok', async (_label, context) => {
    await expectRejected(() => evaluateWire(context));
  });

  const money = (amountMinor: number) => ({ amountMinor, currency: 'TRY' });
  it.each([
    ['teslim sayisi', (n: number) => ({ deliveredOrderCount: n })],
    ['iptal sayisi', (n: number) => ({ cancelledOrderCount: n })],
    ['dwell', (n: number) => ({ checkoutDwellMs: n })],
    ['cihazdaki hesap', (n: number) => ({ accountsOnDevice: n })],
    ['sepet tutari', (n: number) => ({ basketTotal: money(n) })],
    ['ortalama sepet', (n: number) => ({ userAverageBasket: money(n) })],
  ] as const)('L2 %s: -1 ret, 0 kabul', async (_label, change) => {
    await expectRejected(() => evaluateWith(change(-1)), ['-1']);
    await expectAccepted(() => evaluateWith(change(0)));
  });

  it.each(['deliveryLocation', 'sessionLocation'] as const)(
    'L3 %s: sinirda kabul, bir ustunde ret; NaN ve sonsuz ret',
    async (field) => {
      const STEP = 0.000_001;
      const edges: readonly [string, GeoPoint, boolean][] = [
        ['enlem 90', { lat: 90, lng: 0 }, true],
        ['enlem -90', { lat: -90, lng: 0 }, true],
        ['boylam 180', { lat: 0, lng: 180 }, true],
        ['boylam -180', { lat: 0, lng: -180 }, true],
        ['enlem 90 ustu', { lat: 90 + STEP, lng: 0 }, false],
        ['enlem -90 alti', { lat: -90 - STEP, lng: 0 }, false],
        ['boylam 180 ustu', { lat: 0, lng: 180 + STEP }, false],
        ['boylam -180 alti', { lat: 0, lng: -180 - STEP }, false],
        ['enlem NaN', { lat: Number.NaN, lng: 0 }, false],
        ['boylam sonsuz', { lat: 0, lng: Number.POSITIVE_INFINITY }, false],
        ['enlem eksi sonsuz', { lat: Number.NEGATIVE_INFINITY, lng: 0 }, false],
      ];
      const seen: [string, string, number][] = [];
      for (const [label, point] of edges) {
        const before = store.size;
        const result = await evaluateWith(
          field === 'deliveryLocation' ? { deliveryLocation: point } : { sessionLocation: point },
        );
        const outcome =
          result.error === undefined
            ? 'kabul'
            : `${String(result.error.code)} ${appErrorOf(result.error)?.code ?? ''}`;
        seen.push([label, outcome, store.size - before]);
        const sent = [point.lat, point.lng].filter((value) => value !== 0).map(String);
        if (result.error !== undefined) expectNoEcho(result, sent);
      }
      const rejected = `${String(GRPC_STATUS.INVALID_ARGUMENT)} ${ERROR_CODES.VALIDATION_FAILED}`;
      expect(seen).toEqual(
        edges.map(([label, , accepted]) => [
          label,
          accepted ? 'kabul' : rejected,
          accepted ? 1 : 0,
        ]),
      );
    },
  );

  it('L4 tel baytlariyla: Date disi hesap zamani ret, 2^53 ustu tutar INTERNAL; gecerli degerler kabul', async () => {
    const base = { ...toProtoContext(validContext()), accountCreatedAt: undefined };
    const createdAt = (seconds: bigint) => withFirstVarint(FIELD.ACCOUNT_CREATED_AT, seconds);
    // Kontrol: ayni elle yazilmis yol gecerli zamani tasir.
    await expectAccepted(() => evaluateRaw(base, createdAt(BigInt((NOW - 30 * DAY_MS) / 1_000))));
    // 10^13 sn ~ 317.000 yil: Date'in araligi (8,64e15 ms) disinda, "Invalid Date".
    await expectRejected(() => evaluateRaw(base, createdAt(10n ** 13n)), [String(10n ** 13n)]);

    const withoutBasket = { ...toProtoContext(validContext()), basketTotal: undefined };
    const basket = (amountMinor: bigint) => withFirstVarint(FIELD.BASKET_TOTAL, amountMinor);
    await expectAccepted(() => evaluateRaw(withoutBasket, basket(BigInt(Number.MAX_SAFE_INTEGER))));
    const before = store.size;
    const tooLarge = await evaluateRaw(withoutBasket, basket(2n ** 53n + 2n));
    // MEVCUT (#147 sinifi): istek cozulemez, handler hic calismaz; INVALID_ARGUMENT degil.
    expect([tooLarge.error?.code, appErrorOf(tooLarge.error), store.size - before]).toEqual([
      GRPC_STATUS.INTERNAL,
      undefined,
      0,
    ]);
    expect(textOf(tooLarge)).not.toContain('9007199254740994');
  });

  it('L5 MEVCUT (#169): metin alanlarinda uzunluk siniri yok (64 KiB kabul, kayda yazilir, okunur)', async () => {
    // Bu kaydin ani tek: okunan kaydin bu kayit oldugu degerlendirmeyle birebir dogrulanir.
    clock.advance(1_000);
    const long = (prefix: string) => `${prefix}${'x'.repeat(LONG_TEXT_LENGTH)}`;
    const longUser = long('usr_');
    const evaluation = await expectAccepted(() =>
      evaluateWith({
        userId: longUser,
        orderId: long('ord_'),
        marketId: long('mkt_'),
        ipAddress: long('ip_'),
        ipCity: long('sehir_'),
        deviceId: long('dev_'),
        previousIpAddress: long('ip_'),
      }),
    );
    const stored = await store.findLatest({ userId: longUser });
    expect([stored?.userId.length, stored?.evaluatedAt]).toEqual([
      longUser.length,
      evaluation?.evaluatedAt,
    ]);
    const read = await call(riskV1.RiskServiceService.getLastEvaluation, {
      userId: longUser,
      orderId: '',
    });
    expect(read.response?.evaluation).toEqual(evaluation);
  });

  it('L6 GetLastEvaluation: kullanici zorunlu; kimlikler kirpilir; bosluk siparis son degerlendirme', async () => {
    for (const userId of ['', '   ']) {
      await expectRejected(() =>
        call(riskV1.RiskServiceService.getLastEvaluation, { userId, orderId: `ord_${MARK}` }),
      );
    }
    const first = validContext();
    const userId = first.userId;
    const firstOrder = first.orderId ?? '';
    const earlier = await expectAccepted(() => evaluateWire(toProtoContext(first)));
    clock.advance(1_000);
    const second = { ...validContext(), userId, ipAddress: '198.51.100.9' };
    const latest = await expectAccepted(() => evaluateWire(toProtoContext(second)));

    const read = (user: string, orderId: string) =>
      call(riskV1.RiskServiceService.getLastEvaluation, { userId: user, orderId });
    const firstRead = await read(`  ${userId}  `, `  ${firstOrder} `);
    expect(firstRead.response?.evaluation?.evaluatedAt).toEqual(earlier?.evaluatedAt);
    const blankOrder = await read(userId, '   ');
    expect([
      blankOrder.response?.evaluation?.evaluatedAt,
      blankOrder.response?.evaluation?.score,
    ]).toEqual([latest?.evaluatedAt, latest?.score]);
    const notFound = [GRPC_STATUS.NOT_FOUND, ERROR_CODES.NOT_FOUND];
    const missing = await read(userId, `ord_${'9'.repeat(32)}`);
    expect([missing.error?.code, appErrorOf(missing.error)?.code]).toEqual(notFound);
    // Sahiplik: baskasi bu kullanicinin GERCEK siparisini okuyamaz.
    const foreign = await read(validContext().userId, firstOrder);
    expect([foreign.error?.code, appErrorOf(foreign.error)?.code]).toEqual(notFound);
  });
});
