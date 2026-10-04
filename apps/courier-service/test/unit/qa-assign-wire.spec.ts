/**
 * QA kara kutu (T13.1): AssignCourier, GetCourier ve ReleaseCourier GERCEK gRPC
 * istemcisiyle, MOCK'un acilista doldurdugu demo kuryeleriyle (openCourierStore,
 * MOCK=true yolu). Test yalnizca tel uzerindeki cevabi, gRPC kodunu ve
 * `x-app-error` yukunu okur.
 *
 * Market listesi kurye servisinin kendi verisinden DEGIL, katalogun demo
 * verisinden gelir: "katalogdaki her markete 3 kurye" sozu disaridan denetlenir.
 *
 * Backend testlerinde olanlar (tek kurye atamasi, bos marketin NOT_FOUND'u, ord_1 /
 * usr_ / eksik market / eksik konum / enlem 120, StartRoute) burada yinelenmez.
 */

import { AppError, ERROR_CODES, fixedClock, GRPC_STATUS, silentLogger } from '@getir/core';
import type { MutableClock } from '@getir/core';
import { recordingLogger } from '@getir/core/testing';
import type { LogLine } from '@getir/core/testing';
import { courierV1 } from '@getir/proto';
import { appErrorOf, appErrorPayloadOf } from '@getir/service-kit/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { MARKETS } from '../../../catalog-service/src/infrastructure/fixtures/markets.js';
import { COURIER_STATUS } from '../../src/domain/courier.js';
import type { CourierRepository } from '../../src/domain/courier-repository.js';
import { openCourierStore } from '../../src/infrastructure/courier-store.js';
import { InMemoryCourierStore } from '../../src/infrastructure/memory/in-memory-courier-store.js';
import { courier, courierId, MARKET, NOW_MS, orderId } from '../support/couriers.js';
import {
  DEMO_COURIER_COUNT,
  DEMO_COURIERS_PER_MARKET,
  DEMO_MARKET_COUNT,
  isNotFound,
  outcomeOf,
  startQaCourierServer,
} from '../support/qa-courier-harness.js';
import type { QaCourierServer } from '../support/qa-courier-harness.js';

/** Dogrulama hatasinin ayrintisi: alan -> mesaj (x-app-error dis veridir, semadan gecer). */
function detailsOf(error: unknown): Record<string, string> {
  return z.record(z.string()).parse(appErrorPayloadOf(error)?.details ?? {});
}

/** Saatin her adimi: atama anlari birbirinden ayrilsin. */
const TICK_MS = 1_000;

let qa: QaCourierServer | undefined;

afterEach(async () => {
  await qa?.stop();
  qa = undefined;
});

/** MOCK=true yolu: demo kuryeleri acilista bellege yuklenir. */
async function startMock(clock: MutableClock = fixedClock(NOW_MS)) {
  const store = await openCourierStore(undefined, { logger: silentLogger, clock });
  qa = await startQaCourierServer({ repository: store.repository, clock });
  return { qa, clock, repository: store.repository };
}

async function startWith(repository: CourierRepository, clock = fixedClock(NOW_MS)) {
  qa = await startQaCourierServer({ repository, clock });
  return qa;
}

/** Atanan kuryenin kimligi; atama basarisizsa test burada durur. */
async function assignedCourier(server: QaCourierServer, order: string, market: string) {
  const outcome = outcomeOf(await server.assign(order, market));
  if (outcome.kind !== 'atandi') {
    throw new Error(`atama bekleniyordu: ${JSON.stringify(outcome)}`);
  }
  return outcome.courierId;
}

describe('QA T13.1 demo kuryeleri tel uzerinden (MOCK, 21 x 3 = 63)', () => {
  it('katalogun her marketi tam 3 farkli kurye verir; 4. istek NOT_FOUND ve marketi soyler', async () => {
    const { qa: server } = await startMock();
    expect(MARKETS).toHaveLength(DEMO_MARKET_COUNT);

    // Butun marketlere ayni anda 4'er istek: market sinirlari karisirsa burada gorunur.
    const requests = MARKETS.flatMap((market) =>
      Array.from({ length: DEMO_COURIERS_PER_MARKET + 1 }, () => ({
        market,
        order: orderId(),
      })),
    );
    const results = await Promise.all(
      requests.map(({ market, order }) => server.assign(order, market.id)),
    );

    const assigned = new Set<string>();
    for (const market of MARKETS) {
      const mine = results.filter((_, index) => requests[index]?.market.id === market.id);
      const won = mine.flatMap((result, index) =>
        result.response === undefined ? [] : [{ result: result.response, at: index }],
      );
      const lost = mine.filter((result) => result.error !== undefined);

      expect(won, market.id).toHaveLength(DEMO_COURIERS_PER_MARKET);
      for (const { result } of won) {
        expect(result.courier, market.id).toMatchObject({
          marketId: market.id,
          status: courierV1.CourierStatus.COURIER_STATUS_BUSY,
          lastLocation: { lat: market.lat, lng: market.lng },
          darkStoreId: '',
        });
        assigned.add(result.courier?.id ?? '');
      }
      expect(new Set(won.map(({ result }) => result.courier?.id)).size).toBe(
        DEMO_COURIERS_PER_MARKET,
      );
      expect(lost.map((result) => result.error?.code)).toEqual([GRPC_STATUS.NOT_FOUND]);
      expect(appErrorOf(lost[0]?.error)).toEqual({
        code: ERROR_CODES.NOT_FOUND,
        details: { marketId: market.id },
      });
    }
    expect(assigned.size).toBe(DEMO_COURIER_COUNT);
    // Her basarili cevap kendi siparisine bagli kuryeyi doner.
    results.forEach((result, index) => {
      if (result.response !== undefined) {
        expect(result.response.courier?.currentOrderId).toBe(requests[index]?.order);
      }
    });
  });
});

describe('QA T13.1 adil sira (tek market, saat ilerler)', () => {
  it('ata-birak dongusu 30 kez: uc kurye sirayla doner, her biri 10 kez', async () => {
    const { qa: server, clock } = await startMock();
    const cycles = 30;

    const picked: string[] = [];
    for (let index = 0; index < cycles; index += 1) {
      clock.advance(TICK_MS);
      const order = orderId();
      picked.push(await assignedCourier(server, order, MARKET));
      clock.advance(TICK_MS);
      expect((await server.release(order)).response?.released).toBe(true);
    }

    const firstRound = picked.slice(0, DEMO_COURIERS_PER_MARKET);
    expect(new Set(firstRound).size).toBe(DEMO_COURIERS_PER_MARKET);
    expect(picked).toEqual(
      Array.from({ length: cycles }, (_, index) => firstRound[index % DEMO_COURIERS_PER_MARKET]),
    );
  });

  it('sira son atama anindan: birakma sirasi onemsiz; hic atanmamis en onde, esitlikte kimlik', async () => {
    // Kabul edilen kural (PM, 04.10, (a)): en uzun suredir IS ALMAMIS kurye once.
    // Birakma sirasi atama sirasindan farkli: A once atanir ama EN SON bosalir;
    // yine de A once secilir. Bos bekleme suresine gore adil atama bekleyen is #88.
    const { qa: server, clock } = await startMock();
    const orderA = orderId();
    const orderB = orderId();

    // Uc kurye de hic atanmamis (esit): secim kimlik sirasiyla. Atama anlari A < B < C.
    clock.advance(TICK_MS);
    const a = await assignedCourier(server, orderA, MARKET);
    clock.advance(TICK_MS);
    const b = await assignedCourier(server, orderB, MARKET);
    clock.advance(TICK_MS);
    const c = await assignedCourier(server, orderId(), MARKET);
    clock.advance(TICK_MS);
    await server.release(orderB); // B uzun suredir bos
    clock.advance(TICK_MS * 10);
    await server.release(orderA); // A az once bosaldi

    clock.advance(TICK_MS);
    const first = await assignedCourier(server, orderId(), MARKET);
    clock.advance(TICK_MS);
    const second = await assignedCourier(server, orderId(), MARKET);
    const none = await server.assign(orderId(), MARKET);

    expect([a, b, c]).toEqual([a, b, c].slice().sort());
    expect(new Set([a, b, c]).size).toBe(DEMO_COURIERS_PER_MARKET);
    expect([first, second]).toEqual([a, b]);
    expect(isNotFound(outcomeOf(none))).toBe(true);
  });
});

describe('QA T13.1 ayni siparise tekrar istek', () => {
  it('teslimat konumu ve saat degisse de ayni kurye; market dolsa da NOT_FOUND olmaz, baska kurye baglanmaz', async () => {
    const { qa: server, clock } = await startMock();
    const order = orderId();

    const first = await server.assign(order, MARKET);
    clock.advance(TICK_MS * 60);
    const moved = await server.assign(order, MARKET, { lat: 41.01, lng: 28.98 });
    // Marketin kalan iki kuryesi baska siparislere gider: market doldu.
    const others = [await server.assign(orderId(), MARKET), await server.assign(orderId(), MARKET)];
    const whenFull = await server.assign(order, MARKET);
    const stranger = await server.assign(orderId(), MARKET);

    expect(first.error).toBeUndefined();
    expect(moved.response).toEqual(first.response);
    expect(whenFull.response).toEqual(first.response);
    const courierIds = [first, ...others].map((result) => result.response?.courier?.id);
    expect(new Set(courierIds).size).toBe(DEMO_COURIERS_PER_MARKET);
    expect(isNotFound(outcomeOf(stranger))).toBe(true);
    const held = await server.get(first.response?.courier?.id ?? '');
    expect(held.response?.courier?.currentOrderId).toBe(order);
  });
});

describe('QA T13.1 hata kodlari (tel uzerinden)', () => {
  const validOrder = orderId();
  const delivery = { lat: 40.99, lng: 29.03 };

  it.each([
    [
      'bos istek',
      { orderId: '', marketId: '', deliveryLocation: undefined },
      ['deliveryLocation', 'marketId', 'orderId'],
    ],
    [
      'siparis kimligi buyuk harfli hex',
      { orderId: `ord_${'A'.repeat(32)}`, marketId: MARKET, deliveryLocation: delivery },
      ['orderId'],
    ],
    [
      'siparis kimligi 33 hex',
      { orderId: `ord_${'a'.repeat(33)}`, marketId: MARKET, deliveryLocation: delivery },
      ['orderId'],
    ],
    [
      'siparis kimliginin basinda bosluk',
      { orderId: ` ${validOrder}`, marketId: MARKET, deliveryLocation: delivery },
      ['orderId'],
    ],
    [
      'market kimligi oneksiz',
      { orderId: validOrder, marketId: 'migros-jet-moda', deliveryLocation: delivery },
      ['marketId'],
    ],
    [
      'market kimligi govdesiz',
      { orderId: validOrder, marketId: 'mkt_', deliveryLocation: delivery },
      ['marketId'],
    ],
    [
      'enlem NaN',
      { orderId: validOrder, marketId: MARKET, deliveryLocation: { lat: Number.NaN, lng: 29 } },
      ['deliveryLocation.lat'],
    ],
    [
      'boylam sonsuz',
      {
        orderId: validOrder,
        marketId: MARKET,
        deliveryLocation: { lat: 41, lng: Number.POSITIVE_INFINITY },
      },
      ['deliveryLocation.lng'],
    ],
    [
      'boylam 180 disi',
      { orderId: validOrder, marketId: MARKET, deliveryLocation: { lat: 41, lng: 180.5 } },
      ['deliveryLocation.lng'],
    ],
  ])(
    'AssignCourier %s: INVALID_ARGUMENT, ayrinti alani adlandirir, mesaj Turkce; kurye degismez',
    async (_name, request, fields) => {
      const { qa: server, repository } = await startMock();

      const { error } = await server.server.call(
        courierV1.CourierServiceService.assignCourier,
        courierV1.AssignCourierRequest.fromPartial(request),
      );

      expect(error?.code).toBe(GRPC_STATUS.INVALID_ARGUMENT);
      const payload = appErrorPayloadOf(error);
      expect(payload?.code).toBe(ERROR_CODES.VALIDATION_FAILED);
      const details = detailsOf(error);
      expect(Object.keys(details).sort()).toEqual(fields);
      // D6: zod'un Ingilizce varsayilan mesaji disari sizmaz.
      expect(Object.values(details).join(' | ')).not.toMatch(/expected|required|invalid|must/i);
      // Dogrulama depoya ulasmadan durur: marketin ilk kuryesi hala bos.
      expect(isNotFound(outcomeOf(await server.assign(orderId(), MARKET)))).toBe(false);
      expect(await repository.findByOrder(validOrder)).toBeNull();
    },
  );

  it('bicimi dogru ama katalogda olmayan market: dogrulama hatasi degil NOT_FOUND', async () => {
    const { qa: server } = await startMock();

    const { error } = await server.assign(orderId(), 'mkt_boyle-bir-market-yok');

    expect(error?.code).toBe(GRPC_STATUS.NOT_FOUND);
    expect(appErrorOf(error)).toEqual({
      code: ERROR_CODES.NOT_FOUND,
      details: { marketId: 'mkt_boyle-bir-market-yok' },
    });
  });

  it('GetCourier: siparis kimligi verilirse INVALID_ARGUMENT; olmayan kurye NOT_FOUND kimligiyle; OFFLINE ve BUSY dogru eslenir', async () => {
    const order = orderId();
    const server = await startWith(
      new InMemoryCourierStore([
        courier(1, { status: COURIER_STATUS.OFFLINE }),
        courier(2, { status: COURIER_STATUS.BUSY, currentOrderId: order }),
      ]),
    );

    const wrongKind = await server.get(order);
    const missing = await server.get(courierId(99));
    const offline = await server.get(courierId(1));
    const busy = await server.get(courierId(2));

    expect(wrongKind.error?.code).toBe(GRPC_STATUS.INVALID_ARGUMENT);
    expect(Object.keys(detailsOf(wrongKind.error))).toEqual(['courierId']);
    expect(missing.error?.code).toBe(GRPC_STATUS.NOT_FOUND);
    expect(appErrorOf(missing.error)).toEqual({
      code: ERROR_CODES.NOT_FOUND,
      details: { courierId: courierId(99) },
    });
    expect(offline.response?.courier).toMatchObject({
      status: courierV1.CourierStatus.COURIER_STATUS_OFFLINE,
      currentOrderId: '',
    });
    expect(busy.response?.courier).toMatchObject({
      status: courierV1.CourierStatus.COURIER_STATUS_BUSY,
      currentOrderId: order,
    });
  });

  it('ReleaseCourier: kurye kimligi siparis yerine verilirse INVALID_ARGUMENT; hic atanmamis siparis hata degil', async () => {
    const { qa: server } = await startMock();

    const wrongKind = await server.release(courierId(1));
    const never = await server.release(orderId());

    expect(wrongKind.error?.code).toBe(GRPC_STATUS.INVALID_ARGUMENT);
    expect(appErrorOf(wrongKind.error)?.code).toBe(ERROR_CODES.VALIDATION_FAILED);
    expect(never.error).toBeUndefined();
    expect(never.response).toEqual({ released: false, courierId: '' });
  });

  it('depo ulasilamaz: uc RPC de UNAVAILABLE + SERVICE_UNAVAILABLE (order yeniden dener)', async () => {
    const down = (): Promise<never> =>
      Promise.reject(new AppError(ERROR_CODES.SERVICE_UNAVAILABLE, 'Veritabanina ulasilamiyor'));
    const server = await startWith({
      findById: down,
      findByOrder: down,
      claimLeastRecentlyAssigned: down,
      releaseByOrder: down,
    });

    const results = [
      (await server.assign(orderId(), MARKET)).error,
      (await server.get(courierId(1))).error,
      (await server.release(orderId())).error,
    ];

    expect(results.map((error) => error?.code)).toEqual(Array(3).fill(GRPC_STATUS.UNAVAILABLE));
    expect(results.map((error) => appErrorOf(error)?.code)).toEqual(
      Array(3).fill(ERROR_CODES.SERVICE_UNAVAILABLE),
    );
  });

  it('beklenmeyen depo hatasi: INTERNAL, ic mesaj ve adres istemciye sizmaz', async () => {
    const secret = 'mongo-ic-dugum-7.getir.local:27017 kullanici=courier';
    const boom = (): Promise<never> => Promise.reject(new Error(secret));
    const server = await startWith({
      findById: boom,
      findByOrder: boom,
      claimLeastRecentlyAssigned: boom,
      releaseByOrder: boom,
    });

    const { error } = await server.assign(orderId(), MARKET);

    expect(error?.code).toBe(GRPC_STATUS.INTERNAL);
    expect(appErrorOf(error)?.code).toBe(ERROR_CODES.INTERNAL);
    expect(
      JSON.stringify({ details: error?.details, payload: appErrorPayloadOf(error) }),
    ).not.toContain('mongo-ic-dugum');
  });
});

describe('QA T13.1 kisisel veri: kurye adi gunluge yazilmaz', () => {
  it('atama, tekrar, NOT_FOUND, dogrulama, okuma ve birakma yollarinin hicbirinde ad yok; kimlik var', async () => {
    const lines: LogLine[] = [];
    const clock = fixedClock(NOW_MS);
    const store = await openCourierStore(undefined, { logger: silentLogger, clock });
    qa = await startQaCourierServer({
      repository: store.repository,
      clock,
      logger: recordingLogger(lines),
    });
    const orders = [orderId(), orderId(), orderId(), orderId()];

    const assigned = [];
    for (const order of orders) {
      assigned.push(await qa.assign(order, MARKET)); // 4. NOT_FOUND
    }
    await qa.assign(orders[0] ?? '', MARKET); // tekrar
    await qa.assign('ord_1', MARKET); // dogrulama
    const names: string[] = [];
    for (const result of assigned) {
      const id = result.response?.courier?.id;
      if (id !== undefined) {
        names.push((await qa.get(id)).response?.courier?.name ?? '');
      }
    }
    await qa.release(orders[1] ?? '');
    await qa.release(orders[1] ?? ''); // ikinci birakma: released=false
    await qa.get(courierId(99)); // NOT_FOUND

    expect(names).toHaveLength(DEMO_COURIERS_PER_MARKET);
    expect(names.every((name) => name.length > 0)).toBe(true);
    const written = JSON.stringify(lines);
    for (const name of names) {
      expect(written).not.toContain(name);
    }
    expect(written).toContain(assigned[0]?.response?.courier?.id ?? 'kimlik-yok');
    expect(lines.length).toBeGreaterThan(0);
  });
});
