/**
 * QA kara kutu (T13.1 PR 2), gercek Mongo: order'in kurye iscisi ile GERCEK courier-svc
 * arasinda hata ve toparlanma (qa-courier-dispatch.spec.ts'in devami; D18 bolmesi).
 *
 *   7. Cevabi kaybolan atama: courier bagladi, cevap order'a yetismedi; sonraki tur AYNI kurye.
 *   8. Order'in Mongo'su yazimda donar: kurye birakilmaz, toparlaninca ayni kurye.
 *   9. courier coker ve ayni adreste geri gelir: siparisler bekler, sonra atanir.
 *  13. Iscinin GONDERDIGI kuyruk sorgusu (profiler): kismi indeksten, bellekte siralama yok.
 *
 * Burada davranis (cift atama yok, toparlanma var, tutarlilik). Ortak Mongo dunyasi
 * test/support/qa-dispatch-mongo.ts.
 */

import { fixedClock, ORDER_STATUS } from '@getir/core';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { startFreezingProxy } from '../../../../packages/mongo-kit/test/support/freezing-proxy.js';
import { DEPENDENCY_BREAKER_OPEN_MS } from '../../src/config/constants.js';
import { COLLECTIONS } from '../../src/infrastructure/mongo/documents.js';
import type { OrderDocument } from '../../src/infrastructure/mongo/documents.js';
import {
  crossCheck,
  FREE_FIXED_PORT,
  gate,
  placeCouriers,
  QA_NOW_MS,
  waitFor,
} from '../support/qa-courier-world.js';
import {
  busyOf,
  courierOnMongo,
  freshDbs,
  FROZEN_TIMEOUT_MS,
  mongoHostPort,
  onCleanup,
  orderOnMongo,
  ordersOf,
  preparingEvents,
  rawMongo,
  useDispatchMongo,
} from '../support/qa-dispatch-mongo.js';

useDispatchMongo();

describe('QA T13.1 PR 2 kaybolan cevap ve donmus Mongo', () => {
  it('7. courier kuryeyi bagladi ama cevap 1 sn suresini asti: siparis degismez; sonraki tur AYNI kuryeyi yazar, ikinci kurye yok', async () => {
    const dbs = freshDbs();
    const clock = fixedClock(QA_NOW_MS);
    const placed = placeCouriers(2);
    const courier = await courierOnMongo({ dbName: dbs.courier, placed, clock });
    const side = await orderOnMongo({
      dbName: dbs.order,
      courierAddress: courier.service.address,
      clock,
    });
    const order = await side.paid();
    // Kurye baglanir; cevap order'in 1 sn suresi dolana kadar donmez (kapi testte).
    const late = gate();
    let delayed = false;
    courier.hooks.afterClaim = async () => {
      if (delayed) return;
      delayed = true;
      await late.pass();
    };

    await side.tour();
    const lost = await side.order(order.id);
    late.open();
    const bound = await waitFor(async () => (await busyOf(courier.service, placed)).length === 1);
    const holder = (await busyOf(courier.service, placed))[0];
    await side.tour();
    const written = await side.order(order.id);

    expect(lost?.status).toBe(ORDER_STATUS.PAID);
    expect(bound).toBe(true);
    expect(holder?.currentOrderId).toBe(order.id);
    expect(written?.courier?.courierId).toBe(holder?.id);
    expect(await busyOf(courier.service, placed)).toHaveLength(1);
    expect(await preparingEvents(dbs.order, order.id)).toBe(1);
  });

  it('8. order in Mongo su atamanin yazimi sirasinda donar: kurye birakilmaz; cozulunce ayni kurye yazilir, tek olay', async () => {
    const dbs = freshDbs();
    const clock = fixedClock(QA_NOW_MS);
    const placed = placeCouriers(2);
    const proxy = await startFreezingProxy(mongoHostPort());
    onCleanup(() => proxy.close());
    onCleanup(() => proxy.thaw());
    const courier = await courierOnMongo({ dbName: dbs.courier, placed, clock });
    const side = await orderOnMongo({
      dbName: dbs.order,
      courierAddress: courier.service.address,
      clock,
      uri: `mongodb://127.0.0.1:${proxy.port}/?directConnection=true`,
      operationTimeoutMs: FROZEN_TIMEOUT_MS,
    });
    const order = await side.paid();
    let frozen = false;
    // Kurye baglandi; order'in siradaki Mongo islemi atamanin yazimi: orada donar.
    courier.hooks.afterClaim = () => {
      if (!frozen) {
        frozen = true;
        proxy.freeze();
      }
      return Promise.resolve();
    };

    await side.tour();
    proxy.thaw();
    const holderAfterFreeze = (await busyOf(courier.service, placed))[0];
    const converged = await waitFor(async () => {
      await side.tour().catch(() => undefined);
      return (await side.order(order.id).catch(() => null))?.courier !== undefined;
    }, 10_000);
    const written = await side.order(order.id);

    expect(frozen).toBe(true);
    expect(holderAfterFreeze?.currentOrderId).toBe(order.id);
    expect(converged).toBe(true);
    expect(written?.courier?.courierId).toBe(holderAfterFreeze?.id);
    expect(await busyOf(courier.service, placed)).toHaveLength(1);
    expect(await preparingEvents(dbs.order, order.id)).toBe(1);
  });
});

describe('QA T13.1 PR 2 courier coker ve geri gelir (9)', () => {
  it('courier kapaliyken siparisler PAID bekler; ayni adreste geri gelince (devre yeniden kapaninca) atanir, cift atama yok', async () => {
    const dbs = freshDbs();
    const clock = fixedClock(QA_NOW_MS);
    const placed = placeCouriers(3);
    const first = await courierOnMongo({
      dbName: dbs.courier,
      placed,
      clock,
      port: FREE_FIXED_PORT,
    });
    const { port } = first.service;
    const side = await orderOnMongo({
      dbName: dbs.order,
      courierAddress: first.service.address,
      clock,
    });
    const before = await side.paid();

    await first.service.stop();
    const during = await side.paid();
    for (let tour = 0; tour < 7; tour += 1) {
      await side.tour();
    }
    const waiting = await ordersOf(side, [before.id, during.id]);
    const back = await courierOnMongo({ dbName: dbs.courier, clock, port });
    const recovered = await waitFor(async () => {
      await side.tour();
      const orders = await ordersOf(side, [before.id, during.id]);
      return orders.every((order) => order.courier !== undefined);
    }, DEPENDENCY_BREAKER_OPEN_MS + 10_000);
    const after = await ordersOf(side, [before.id, during.id]);

    expect(waiting.map((order) => order.status)).toEqual([ORDER_STATUS.PAID, ORDER_STATUS.PAID]);
    expect(recovered).toBe(true);
    expect(new Set(after.map((order) => order.courier?.courierId)).size).toBe(2);
    expect(await crossCheck(back.service, placed, after)).toEqual([]);
  });
});

/** Profiler satiri: servisin GONDERDIGI sorgu ve plani (dis veri: semadan gecer). */
const profileEntrySchema = z
  .object({
    planSummary: z.string().optional(),
    keysExamined: z.number().optional(),
    hasSortStage: z.boolean().optional(),
    command: z.object({ filter: z.unknown().optional() }).passthrough().optional(),
  })
  .passthrough();

describe('QA T13.1 PR 2 iscinin kuyruk sorgusu (13)', () => {
  it('profiler: sorgu kismi indeksten okunur, COLLSCAN ve bellekte siralama yok; teslim/iptal gecmisi indekse girmez', async () => {
    const dbs = freshDbs();
    const clock = fixedClock(QA_NOW_MS);
    const courier = await courierOnMongo({ dbName: dbs.courier, placed: [], clock });
    const side = await orderOnMongo({
      dbName: dbs.order,
      courierAddress: courier.service.address,
      clock,
    });
    const history: string[] = [];
    for (let index = 0; index < 40; index += 1) {
      history.push((await side.paid()).id);
    }
    const orders = rawMongo().db(dbs.order).collection<OrderDocument>(COLLECTIONS.ORDERS);
    await orders.updateMany(
      { _id: { $in: history.slice(0, 30) } },
      {
        $set: { status: ORDER_STATUS.DELIVERED },
      },
    );
    await orders.updateMany(
      { _id: { $in: history.slice(30) } },
      {
        $set: { status: ORDER_STATUS.CANCELLED },
      },
    );
    const live = [(await side.paid()).id, (await side.paid()).id, (await side.paid()).id];

    await rawMongo().db(dbs.order).command({ profile: 2 });
    await side.tour();
    await rawMongo().db(dbs.order).command({ profile: 0 });
    const entries = (
      await rawMongo()
        .db(dbs.order)
        .collection('system.profile')
        .find({ ns: `${dbs.order}.${COLLECTIONS.ORDERS}`, op: 'query' })
        .toArray()
    ).map((entry) => profileEntrySchema.parse(entry));
    const queue = entries.filter((entry) => JSON.stringify(entry.command?.filter).includes('$or'));
    const validation = z
      .object({ keysPerIndex: z.record(z.number()) })
      .passthrough()
      .parse(await rawMongo().db(dbs.order).command({ validate: COLLECTIONS.ORDERS }));

    expect(queue.length).toBeGreaterThan(0);
    for (const entry of queue) {
      // Plan ozeti indeksi anahtariyla yazar: status_courierRetryAt_id.
      expect(entry.planSummary).toContain('IXSCAN { status: 1, courierRetryAt: 1, _id: 1 }');
      expect(entry.planSummary).not.toContain('COLLSCAN');
      expect(entry.hasSortStage ?? false).toBe(false);
      expect(entry.keysExamined ?? 0).toBeLessThanOrEqual(live.length + 2);
    }
    // Kismi indeks: yalnizca kurye bekleyebilen (PAID, PREPARING) siparisler; 40 gecmis disarida.
    expect(validation.keysPerIndex.status_courierRetryAt_id).toBe(live.length);
  });
});
