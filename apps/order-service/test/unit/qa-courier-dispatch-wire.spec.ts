/**
 * QA kara kutu (T13.1 PR 2): order'in kurye iscisi GERCEK courier-svc'ye gercek
 * gRPC ile (uretimdeki istemci ayarlari: 1 sn sure, D17 devre ve yeniden deneme).
 * Iki taraf da bellekte (MOCK depolari); Mongo'lu senaryolar
 * test/integration/qa-courier-dispatch.spec.ts'te.
 *
 * Bu dosya DAVRANISI dogrular, gunluk metnini ve sirayi DEGIL: bekleyen siparislerin
 * sirasi (#92 FIFO), Mongo/courier hata ayrimi (D1), gunluk sikligi (D2) ve kalici
 * hatada geri cekilme (D3) sonraki order PR'inda degisecek.
 *
 *   3. Turda en fazla COURIER_DISPATCH_BATCH_SIZE siparis; kalanlar sonraki turda.
 *  10. Yavas courier (cevap > 1 sn): cift atama yok, courier hizlaninca toparlanir.
 *  11. courier'in reddettigi (INVALID_ARGUMENT) siparis digerlerini engellemez, devreyi acmaz.
 *  12. Kapanis: stop suren turu bekler, yarim atama birakmaz, sonra tur yok.
 *  14. MOCK: order ve courier ikisi de MOCK'ta; atama olur, kurye adi gunluklerde yok.
 */

import { fixedClock, ORDER_STATUS, silentLogger } from '@getir/core';
import type { MutableClock } from '@getir/core';
import { recordingLogger } from '@getir/core/testing';
import type { LogLine } from '@getir/core/testing';
import { afterEach, describe, expect, it } from 'vitest';

import { openCourierStore } from '../../../courier-service/src/infrastructure/courier-store.js';
import { InMemoryCourierStore } from '../../../courier-service/src/infrastructure/memory/in-memory-courier-store.js';
import { COURIER_DISPATCH_BATCH_SIZE } from '../../src/config/constants.js';
import type { Order } from '../../src/domain/order.js';
import { openOrderStore } from '../../src/infrastructure/order-store.js';
import {
  crossCheck,
  gate,
  HookedCourierRepository,
  isBusy,
  orderSide,
  placeCouriers,
  QA_NOW_MS,
  sleep,
  startCourierService,
  waitFor,
} from '../support/qa-courier-world.js';
import type { QaCourierService, QaOrderSide } from '../support/qa-courier-world.js';

/** Iscinin test araligi: turlar hizli donsun. */
const WORKER_INTERVAL_MS = 20;

const cleanups: (() => Promise<void> | void)[] = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) {
    await cleanup();
  }
});

interface World {
  readonly courier: QaCourierService;
  readonly hooks: HookedCourierRepository;
  readonly order: QaOrderSide;
  readonly placed: ReturnType<typeof placeCouriers>;
  readonly courierLines: LogLine[];
  readonly orderLines: LogLine[];
  readonly clock: MutableClock;
}

/** Bellekte iki taraf: `count` kurye marketin konumunda. */
async function world(count: number): Promise<World> {
  const clock = fixedClock(QA_NOW_MS);
  const courierLines: LogLine[] = [];
  const orderLines: LogLine[] = [];
  const placed = placeCouriers(count);
  const hooks = new HookedCourierRepository(new InMemoryCourierStore(placed));
  const courier = await startCourierService({
    repository: hooks,
    clock,
    logger: recordingLogger(courierLines),
  });
  cleanups.push(() => courier.stop());
  const store = await openOrderStore(undefined, silentLogger, 'test');
  const order = orderSide({
    store,
    courierAddress: courier.address,
    clock,
    logger: recordingLogger(orderLines),
  });
  cleanups.push(() => order.close());
  return { courier, hooks, order, placed, courierLines, orderLines, clock };
}

/** courier'e ulasan AssignCourier istekleri (istek kimligine gore tekil; tekrar denemesi ayni kimlikle). */
function assignRequests(lines: readonly LogLine[]): Set<unknown> {
  return new Set(
    lines
      .filter((line) => line.fields.rpc === 'AssignCourier')
      .map((line) => line.fields.requestId),
  );
}

async function ordersOf(side: QaOrderSide, ids: readonly string[]): Promise<Order[]> {
  const found = await Promise.all(ids.map((id) => side.order(id)));
  return found.flatMap((order) => (order === null ? [] : [order]));
}

describe('QA T13.1 PR 2 tur siniri (3)', () => {
  it(`turda en fazla ${COURIER_DISPATCH_BATCH_SIZE} siparis courier'e gider; kalanlar sonraki turda (sira #92 ile degisecek, kilitlenmez)`, async () => {
    const w = await world(0);
    const total = COURIER_DISPATCH_BATCH_SIZE + 50;
    const ids: string[] = [];
    for (let index = 0; index < total; index += 1) {
      ids.push((await w.order.paid()).id);
    }

    await w.order.tour();
    const askedFirst = assignRequests(w.courierLines).size;
    const paidAfterFirst = (await ordersOf(w.order, ids)).filter(
      (order) => order.status === ORDER_STATUS.PAID,
    ).length;
    await w.order.tour();
    const afterSecond = await ordersOf(w.order, ids);

    expect(askedFirst).toBeGreaterThan(0);
    expect(askedFirst).toBeLessThanOrEqual(COURIER_DISPATCH_BATCH_SIZE);
    expect(total - paidAfterFirst).toBeLessThanOrEqual(COURIER_DISPATCH_BATCH_SIZE);
    // Bos kurye yok: hepsi kuryesiz PREPARING'de bekliyor, hicbiri unutulmadi.
    expect(afterSecond.map((order) => [order.status, order.courier])).toEqual(
      Array.from({ length: total }, () => [ORDER_STATUS.PREPARING, undefined]),
    );
  });
});

describe('QA T13.1 PR 2 yavas courier (10)', () => {
  it('cevap 1 sn suresini asarsa siparis degismez; courier hizlaninca her siparis TEK kuryeyle, cift atama yok', async () => {
    const w = await world(3);
    const ids = [(await w.order.paid()).id, (await w.order.paid()).id, (await w.order.paid()).id];
    // courier'in atamasi order'in 1 sn suresi dolana kadar bitmez (kapi testte).
    const slow = gate();
    w.hooks.beforeClaim = () => slow.pass();

    await w.order.tour();
    await w.order.tour();
    const duringSlow = await ordersOf(w.order, ids);
    const stuck = slow.waiting;
    w.hooks.beforeClaim = undefined;
    slow.open();
    // Yolda kalan (order'in vazgectigi) atamalar courier'da tamamlansin.
    await waitFor(() => Promise.resolve(slow.waiting === 0));
    await sleep(50);
    for (let tour = 0; tour < 5; tour += 1) {
      await w.order.tour();
    }
    const after = await ordersOf(w.order, ids);

    expect(stuck).toBeGreaterThan(0);
    expect(duringSlow.every((order) => order.status === ORDER_STATUS.PAID)).toBe(true);
    expect(after.every((order) => order.courier !== undefined)).toBe(true);
    expect(new Set(after.map((order) => order.courier?.courierId)).size).toBe(3);
    expect(await crossCheck(w.courier, w.placed, after)).toEqual([]);
  });
});

describe('QA T13.1 PR 2 courier in reddettigi siparis (11)', () => {
  it('INVALID_ARGUMENT alan siparis kurye almaz, digerlerini engellemez, devreyi acmaz', async () => {
    const w = await world(4);
    // Sozlesme disi eski kayit gibi: market kimligi bicimsiz (courier dogrulamasi reddeder).
    // Ilk yazilan ve en kucuk kimlikli: bugunku sirada da FIFO'da (#92) da kuyrugun basinda.
    const broken = await w.order.paidAs(`ord_${'0'.repeat(32)}`, { marketId: 'mkt_' });
    const good = [(await w.order.paid()).id, (await w.order.paid()).id];

    // Devre esigini (5) gececek kadar tur: reddedilen istek ulasilamazlik sayilmamali.
    for (let tour = 0; tour < 7; tour += 1) {
      await w.order.tour();
    }
    const late = await w.order.paid();
    await w.order.tour();

    const all = await ordersOf(w.order, [broken.id, ...good, late.id]);
    const [brokenNow, ...rest] = all;
    expect(brokenNow?.courier).toBeUndefined();
    expect(rest.map((order) => order.courier !== undefined)).toEqual([true, true, true]);
    expect(await crossCheck(w.courier, w.placed, all)).toEqual([]);
  });
});

describe('QA T13.1 PR 2 kapanis (12)', () => {
  it('stop suren turu BEKLER: atama yazilir, courier ile tutarli; stop sonrasi tur yok', async () => {
    const w = await world(1);
    const order = await w.order.paid();
    let entered: () => void = () => undefined;
    const inClaim = new Promise<void>((resolve) => {
      entered = resolve;
    });
    w.hooks.beforeClaim = async () => {
      entered();
      await sleep(300);
    };
    const worker = w.order.startWorker(WORKER_INTERVAL_MS);

    await inClaim;
    await worker.stop();
    const asked = assignRequests(w.courierLines).size;
    const written = await w.order.order(order.id);
    await sleep(WORKER_INTERVAL_MS * 5);

    expect(written?.courier?.courierId).toBe(w.placed[0]?.id);
    expect(await crossCheck(w.courier, w.placed, written === null ? [] : [written])).toEqual([]);
    expect(assignRequests(w.courierLines).size).toBe(asked);
  });
});

describe('QA T13.1 PR 2 MOCK (14)', () => {
  it('order ve courier MOCK ta: odenen siparis kuryeyle PREPARING; kurye adi iki gunlukte de yok', async () => {
    const clock = fixedClock(QA_NOW_MS);
    const courierLines: LogLine[] = [];
    const orderLines: LogLine[] = [];
    const courierStore = await openCourierStore(undefined, { logger: silentLogger, clock });
    const courier = await startCourierService({
      repository: courierStore.repository,
      clock,
      logger: recordingLogger(courierLines),
    });
    cleanups.push(() => courier.stop());
    const store = await openOrderStore(undefined, silentLogger, 'test');
    const side = orderSide({
      store,
      courierAddress: courier.address,
      clock,
      logger: recordingLogger(orderLines),
    });
    cleanups.push(() => side.close());
    const order = await side.paid();

    const worker = side.startWorker(WORKER_INTERVAL_MS);
    const assigned = await waitFor(async () => (await side.order(order.id))?.courier !== undefined);
    await worker.stop();

    expect(assigned).toBe(true);
    const written = await side.order(order.id);
    expect(written?.status).toBe(ORDER_STATUS.PREPARING);
    const held = await courier.get(written?.courier?.courierId ?? '');
    expect(isBusy(held)).toBe(true);
    expect(held?.currentOrderId).toBe(order.id);
    const name = held?.name ?? '';
    expect(name.length).toBeGreaterThan(0);
    expect(JSON.stringify(orderLines)).not.toContain(name);
    expect(JSON.stringify(courierLines)).not.toContain(name);
    expect(JSON.stringify(orderLines)).toContain(held?.id ?? 'kimlik-yok');
  });
});
