/**
 * QA kara kutu (T13.1 PR 2), gercek Mongo (Testcontainers): order'in kurye iscisi
 * GERCEK courier-svc'ye gercek gRPC ile baglanir; iki servis ayri veritabaninda
 * (D14), courier'in deposu da Mongo. Backend testlerinde courier sahtedir.
 *
 * Courier'in durumu courier'in kendi RPC'siyle (GetCourier), order'inki deposundan
 * okunur; "capraz tutarlilik" ikisinin ayni seyi soylemesidir (crossCheck).
 *
 *   1. "Bitti sayilir" uctan uca: kurye iki tarafta da ayni; tek olay; ayni istek kimligi.
 *   2. Kurye yok: kuryesiz PREPARING bekler; kurye bosalinca en gec deneme aninda alir.
 *   4. Iki order + iki courier kopyasi ayni anda: kurye bolunmez, iki taraf tutarli.
 *   5. QA T3, gercek courier: atama ucustayken siparis kapanir; kurye GERI verilir.
 *   6. Bilinen sinir (README): telafinin birakmasi da duserse kurye BUSY kalir.
 *
 * Hata ve toparlanma senaryolari (7, 8, 9, 13) qa-courier-dispatch-failures.spec.ts'te;
 * ortak Mongo dunyasi test/support/qa-dispatch-mongo.ts (D18 bolmesi). Kuyruk sirasi
 * (#92), O2 ve gunluk/geri cekilme (D1-D3) T13.2 QA dosyalarinda: qa-courier-queue,
 * qa-order-migration-0001, qa-dispatch-reachability, unit/qa-dispatch-backoff.
 */

import { fixedClock, ORDER_STATUS } from '@getir/core';
import type { LogLine } from '@getir/core/testing';
import { courierV1 } from '@getir/proto';
import { describe, expect, it } from 'vitest';

import { COURIER_RETRY_DELAY_MS } from '../../src/config/constants.js';
import {
  crossCheck,
  isBusy,
  placeCouriers,
  QA_NOW_MS,
  storeUnavailable,
} from '../support/qa-courier-world.js';
import {
  busyOf,
  cancelOrder,
  courierOnMongo,
  freshDbs,
  orderOnMongo,
  ordersOf,
  preparingEvents,
  useDispatchMongo,
} from '../support/qa-dispatch-mongo.js';

useDispatchMongo();

describe('QA T13.1 PR 2 uctan uca (gercek courier, gercek Mongo)', () => {
  it('1. odenen siparis kuryeyle PREPARING; courier ayni kuryeyi BUSY tutar; tek olay; ayni istek kimligi', async () => {
    const dbs = freshDbs();
    const clock = fixedClock(QA_NOW_MS);
    const courierLines: LogLine[] = [];
    const orderLines: LogLine[] = [];
    const placed = placeCouriers(2);
    const courier = await courierOnMongo({
      dbName: dbs.courier,
      placed,
      clock,
      lines: courierLines,
    });
    const side = await orderOnMongo({
      dbName: dbs.order,
      courierAddress: courier.service.address,
      clock,
      lines: orderLines,
    });
    const order = await side.paid();

    await side.tour();
    const written = await side.order(order.id);

    expect(written?.status).toBe(ORDER_STATUS.PREPARING);
    expect(written?.courier).toBeDefined();
    expect(written?.courierRetryAt).toBeUndefined();
    expect(await crossCheck(courier.service, placed, written === null ? [] : [written])).toEqual(
      [],
    );
    expect(await busyOf(courier.service, placed)).toHaveLength(1);
    expect(await preparingEvents(dbs.order, order.id)).toBe(1);
    // D16: siparisin istegi courier'a ayni kimlikle gider.
    const orderRequestIds = new Set(
      orderLines
        .filter((line) => line.fields.orderId === order.id)
        .map((line) => line.fields.requestId),
    );
    const courierRequestIds = courierLines
      .filter((line) => line.fields.rpc === 'AssignCourier')
      .map((line) => line.fields.requestId);
    expect(courierRequestIds.length).toBeGreaterThan(0);
    expect(courierRequestIds.some((id) => orderRequestIds.has(id))).toBe(true);
  });

  it('2. bos kurye yok: kuryesiz PREPARING bekler (olay bir kez); kurye bosalinca en gec deneme aninda alir', async () => {
    const dbs = freshDbs();
    const clock = fixedClock(QA_NOW_MS);
    const placed = placeCouriers(1);
    const courier = await courierOnMongo({ dbName: dbs.courier, placed, clock });
    const side = await orderOnMongo({
      dbName: dbs.order,
      courierAddress: courier.service.address,
      clock,
    });
    const first = await side.paid();
    await side.tour();
    const waiting = await side.paid();

    await side.tour();
    const queued = await side.order(waiting.id);
    // Teslimat kapanisi gibi (T13.x): ilk siparisin kuryesi courier'da bosalir.
    const released = await courier.service.release(first.id);
    clock.advance(COURIER_RETRY_DELAY_MS);
    await side.tour();
    const assigned = await side.order(waiting.id);

    expect(queued).toMatchObject({ status: ORDER_STATUS.PREPARING });
    expect(queued?.courier).toBeUndefined();
    expect(released?.released).toBe(true);
    expect(assigned?.courier?.courierId).toBe(placed[0]?.id);
    expect(assigned?.courierRetryAt).toBeUndefined();
    expect(await crossCheck(courier.service, placed, assigned === null ? [] : [assigned])).toEqual(
      [],
    );
    expect(await preparingEvents(dbs.order, waiting.id)).toBe(1);
  });
});

describe('QA T13.1 PR 2 iki order + iki courier kopyasi (4)', () => {
  it('40 siparis, 5 kurye, turlar ayni anda: tek kurye tek siparis, iki taraf tutarli, siparis basina tek olay; bosalan kuryeler de tutarli dagilir', async () => {
    const dbs = freshDbs();
    const clock = fixedClock(QA_NOW_MS);
    const placed = placeCouriers(5);
    const courierA = await courierOnMongo({ dbName: dbs.courier, placed, clock });
    const courierB = await courierOnMongo({ dbName: dbs.courier, clock });
    const sideA = await orderOnMongo({
      dbName: dbs.order,
      courierAddress: courierA.service.address,
      clock,
    });
    const sideB = await orderOnMongo({
      dbName: dbs.order,
      courierAddress: courierB.service.address,
      clock,
    });
    const ids: string[] = [];
    for (let index = 0; index < 40; index += 1) {
      ids.push((await sideA.paid()).id);
    }

    for (let round = 0; round < 4; round += 1) {
      await Promise.all([sideA.tour(), sideB.tour()]);
    }
    const settled = await ordersOf(sideA, ids);
    const withCourier = settled.filter((order) => order.courier !== undefined);

    expect(withCourier).toHaveLength(5);
    expect(settled.every((order) => order.status === ORDER_STATUS.PREPARING)).toBe(true);
    expect(await crossCheck(courierA.service, placed, settled)).toEqual([]);
    for (const id of ids) {
      expect(await preparingEvents(dbs.order, id), id).toBe(1);
    }

    // Iki teslimat kapanir (T13.x): kuryeler bosalir, bekleyenler deneme aninda yarisir.
    const delivered = withCourier.slice(0, 2).map((order) => order.id);
    for (const id of delivered) {
      expect((await courierA.service.release(id))?.released).toBe(true);
    }
    clock.advance(COURIER_RETRY_DELAY_MS);
    for (let round = 0; round < 3; round += 1) {
      await Promise.all([sideA.tour(), sideB.tour()]);
    }
    const later = (await ordersOf(sideA, ids)).filter((order) => !delivered.includes(order.id));

    expect(later.filter((order) => order.courier !== undefined)).toHaveLength(5);
    expect(await crossCheck(courierB.service, placed, later)).toEqual([]);
    for (const id of ids) {
      expect(await preparingEvents(dbs.order, id), id).toBe(1);
    }
  });
});

describe('QA T13.1 PR 2 telafi (QA T3) gercek courier ile', () => {
  it('5. atama ucustayken siparis iptal; iptalin birakmasi bos doner; order yazamaz ve kuryeyi GERI verir', async () => {
    const dbs = freshDbs();
    const clock = fixedClock(QA_NOW_MS);
    const placed = placeCouriers(1);
    const courier = await courierOnMongo({ dbName: dbs.courier, placed, clock });
    const side = await orderOnMongo({
      dbName: dbs.order,
      courierAddress: courier.service.address,
      clock,
    });
    const victim = await side.paid();
    let earlyRelease: courierV1.ReleaseCourierResponse | undefined;
    courier.hooks.beforeClaim = async (request) => {
      if (request.orderId !== victim.id) return;
      courier.hooks.beforeClaim = undefined;
      await cancelOrder(side, victim.id);
      // Iptal yolunun birakmasi atamadan ONCE varir: tasiyan kurye henuz yok.
      earlyRelease = await courier.service.release(victim.id);
    };

    await side.tour();
    const after = await side.order(victim.id);
    const state = await courier.service.get(placed[0]?.id ?? '');
    const next = await side.paid();
    await side.tour();

    expect(earlyRelease).toEqual({ released: false, courierId: '' });
    expect(after?.status).toBe(ORDER_STATUS.CANCELLED);
    expect(after?.courier).toBeUndefined();
    expect(state?.status).toBe(courierV1.CourierStatus.COURIER_STATUS_IDLE);
    expect(state?.currentOrderId).toBe('');
    expect(await preparingEvents(dbs.order, victim.id)).toBe(0);
    // Geri verilen kurye yeniden kullanilir.
    expect((await side.order(next.id))?.courier?.courierId).toBe(placed[0]?.id);
  });

  it('6. BILINEN SINIR (order README): telafinin birakmasi da duserse kurye BUSY kalir; isci iptal edilmis siparisi bir daha gormez', async () => {
    const dbs = freshDbs();
    const clock = fixedClock(QA_NOW_MS);
    const placed = placeCouriers(1);
    const courier = await courierOnMongo({ dbName: dbs.courier, placed, clock });
    const side = await orderOnMongo({
      dbName: dbs.order,
      courierAddress: courier.service.address,
      clock,
    });
    const victim = await side.paid();
    courier.hooks.beforeClaim = async (request) => {
      if (request.orderId !== victim.id) return;
      courier.hooks.beforeClaim = undefined;
      await cancelOrder(side, victim.id);
      // Telafinin birakmasi geldiginde courier'in deposu yok.
      courier.hooks.releaseFailure = storeUnavailable();
    };

    await side.tour();
    courier.hooks.releaseFailure = undefined;
    for (let tour = 0; tour < 3; tour += 1) {
      await side.tour();
    }
    const state = await courier.service.get(placed[0]?.id ?? '');

    expect((await side.order(victim.id))?.status).toBe(ORDER_STATUS.CANCELLED);
    expect(isBusy(state)).toBe(true);
    expect(state?.currentOrderId).toBe(victim.id);
  });
});
