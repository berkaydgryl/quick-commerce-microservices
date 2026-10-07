/**
 * GetCourier (NOT_FOUND) ve ReleaseCourier (tekrar guvenli; T13.3: birakilan
 * kuryenin ilerleyen rotasi ENDED, kurye konumu degismez) use-case'leri.
 */

import { ERROR_CODES, fixedClock } from '@getir/core';
import { recordingLogger } from '@getir/core/testing';
import type { LogLine } from '@getir/core/testing';
import { describe, expect, it } from 'vitest';

import { createGetCourier } from '../../src/application/get-courier.js';
import { createReleaseCourier } from '../../src/application/release-courier.js';
import { COURIER_STATUS } from '../../src/domain/courier.js';
import { ROUTE_STATE } from '../../src/domain/route.js';
import type { Route } from '../../src/domain/route.js';
import { InMemoryCourierStore } from '../../src/infrastructure/memory/in-memory-courier-store.js';
import { InMemoryRouteStore } from '../../src/infrastructure/memory/in-memory-route-store.js';
import { courier, courierId, DELIVERY, NOW_MS, orderId } from '../support/couriers.js';

describe('createGetCourier', () => {
  it('kuryeyi doner; yoksa NOT_FOUND', async () => {
    const get = createGetCourier(new InMemoryCourierStore([courier(1)]));

    await expect(get(courierId(1))).resolves.toEqual(courier(1));
    await expect(get(courierId(2))).rejects.toMatchObject({
      code: ERROR_CODES.NOT_FOUND,
      details: { courierId: courierId(2) },
    });
  });
});

describe('createReleaseCourier', () => {
  it('siparisi tasiyan kuryeyi birakir; tekrar cagri hata degil released=false', async () => {
    const order = orderId();
    const repository = new InMemoryCourierStore([
      courier(1, { status: COURIER_STATUS.BUSY, currentOrderId: order }),
    ]);
    const release = createReleaseCourier({ couriers: repository, clock: fixedClock(NOW_MS) });
    const lines: LogLine[] = [];

    const first = await release(order, recordingLogger(lines));
    const second = await release(order, recordingLogger(lines));

    expect(first).toEqual({ released: true, courierId: courierId(1) });
    expect(second).toEqual({ released: false });
    // Kurye oldugu yerde IDLE kalir; bosta beklemesi birakma aninda baslar (#88).
    expect(await repository.findById(courierId(1))).toEqual(
      courier(1, { idleSince: new Date(NOW_MS) }),
    );
    expect(lines.map((line) => [line.message, line.fields])).toEqual([
      ['kurye birakildi', { orderId: order, courierId: courierId(1) }],
      ['birakilacak kurye yok (zaten birakilmis ya da atanmamis)', { orderId: order }],
    ]);
  });
});

describe('createReleaseCourier: rota (T13.3, M6 a)', () => {
  const RELEASE_MS = NOW_MS + 90_000;

  async function setup(fields: Partial<Route> = {}) {
    const order = orderId();
    const couriers = new InMemoryCourierStore([
      courier(1, { status: COURIER_STATUS.BUSY, currentOrderId: order }),
    ]);
    const routes = new InMemoryRouteStore();
    await routes.insertOnce({
      orderId: order,
      courierId: courierId(1),
      points: [DELIVERY],
      pickupIndex: 0,
      distanceMeters: 0,
      etaSeconds: 0,
      createdAt: new Date(NOW_MS),
      state: ROUTE_STATE.MOVING,
      ...fields,
    });
    const lines: LogLine[] = [];
    const release = createReleaseCourier({ couriers, routes, clock: fixedClock(RELEASE_MS) });
    return { order, couriers, routes, lines, release };
  }

  it('birakilan kuryenin ilerleyen rotasi ENDED (tick beklenmez); kurye konumu DEGISMEZ', async () => {
    const { order, couriers, routes, lines, release } = await setup();

    expect(await release(order, recordingLogger(lines))).toEqual({
      released: true,
      courierId: courierId(1),
    });
    expect(await routes.findByOrder(order)).toMatchObject({
      state: ROUTE_STATE.ENDED,
      endedAt: new Date(RELEASE_MS),
    });
    expect((await couriers.findById(courierId(1)))?.lastLocation).toEqual(courier(1).lastLocation);
    expect(await routes.listMoving(10)).toEqual([]);
  });

  it.each([
    ['baska kuryenin rotasi', { courierId: courierId(2) }],
    ['teslimi kaydedilmis rota', { deliveredAt: new Date(NOW_MS + 60_000) }],
    ['bitmis rota', { state: ROUTE_STATE.DONE }],
  ])('%s: rotaya dokunulmaz', async (_name, fields) => {
    const { order, routes, lines, release } = await setup(fields);
    const before = await routes.findByOrder(order);

    await release(order, recordingLogger(lines));

    expect(await routes.findByOrder(order)).toEqual(before);
  });

  it('rota yazilamazsa kurye yine birakilmis: WARN, tick bitirecek', async () => {
    const { order, routes, lines, release } = await setup();
    routes.update = () => Promise.reject(new Error('mongo zaman asimi'));

    expect((await release(order, recordingLogger(lines))).released).toBe(true);
    expect(lines.at(-1)).toMatchObject({
      level: 'warn',
      message: 'rota bitirilemedi; tick bitirecek',
    });
  });
});
