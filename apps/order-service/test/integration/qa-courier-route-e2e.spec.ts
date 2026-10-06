/**
 * QA kara kutu (T13.2 PR 3, #124; QA Q7): siparisten rotaya uctan uca. Order'in
 * uretimdeki kurye iscisi (tur) GERCEK courier-svc'ye gercek gRPC ile baglanir;
 * courier uretimdeki acilisla (openCourierStore) kendi Mongo'sunda: kuryeler,
 * market kopyasi ve routes. Backend'in courier testleri rotayi courier icinde
 * sinar; burada order'in gozunden:
 *
 *   - isci atadiginda courier'in routes belgesi (_id = siparis) siparisteki
 *     kuryeyi tasir; son nokta siparisin teslimat adresi, market noktasi
 *     KATALOGDAKI market konumu (courier'in market kopyasi katalogla ayni mi);
 *   - ETA, distance_meters'tan istemcinin bulacagi deger (B4);
 *   - StartRoute ayni rotayi atama aniyla doner;
 *   - order belgesi rota tasimaz, tek PREPARING olayi; ikinci tur rotaya dokunmaz.
 */

import { fixedClock, ID_PREFIX, newId } from '@getir/core';
import { MongoDBContainer } from '@testcontainers/mongodb';
import type { StartedMongoDBContainer } from '@testcontainers/mongodb';
import { MongoClient } from 'mongodb';
import type { Document } from 'mongodb';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { DEFAULT_COURIER_SPEED_KMH } from '../../../courier-service/src/config/constants.js';
import { COLLECTIONS as COURIER_COLLECTIONS } from '../../../courier-service/src/infrastructure/mongo/documents.js';
import { COLLECTIONS } from '../../src/infrastructure/mongo/documents.js';
import { placeCouriers, QA_DELIVERY, QA_MARKET, QA_NOW_MS } from '../support/qa-courier-world.js';
import { courierOnMongo, orderOnMongo, preparingEvents } from '../support/qa-mongo-world.js';
import type { Cleanups } from '../support/qa-mongo-world.js';

const MONGO_IMAGE = 'mongo:7';

let container: StartedMongoDBContainer;
let raw: MongoClient;
const cleanups: Cleanups = [];

const uri = (): string => `${container.getConnectionString()}/?directConnection=true`;

beforeAll(async () => {
  container = await new MongoDBContainer(MONGO_IMAGE).start();
  raw = await MongoClient.connect(uri());
});

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) {
    await cleanup();
  }
});

afterAll(async () => {
  await raw?.close();
  await container?.stop();
});

describe('QA siparisten rotaya (#124, Q7): gercek order iscisi + gercek courier, ikisi de Mongo da', () => {
  it('isci atar: routes belgesi siparisteki kuryeyle, son nokta teslimat adresi, market noktasi katalogdaki konum; StartRoute ayni; order rota tasimaz', async () => {
    const tag = newId(ID_PREFIX.EVENT).slice(-8);
    const dbs = { order: `qa_order_${tag}`, courier: `qa_courier_${tag}` };
    const clock = fixedClock(QA_NOW_MS);
    const placed = placeCouriers(2);
    const courier = await courierOnMongo({
      uri: uri(),
      dbName: dbs.courier,
      placed,
      clock,
      cleanups,
    });
    const side = await orderOnMongo({
      uri: uri(),
      dbName: dbs.order,
      courierAddress: courier.service.address,
      clock,
      cleanups,
    });
    const routes = raw.db(dbs.courier).collection<Document>(COURIER_COLLECTIONS.ROUTES);

    const paid = await side.paid();
    await side.tour();
    const assigned = await side.order(paid.id);
    const courierId = assigned?.courier?.courierId ?? '';
    const route = await routes.findOne({ _id: paid.id } as Document);
    const points = (route?.['points'] ?? []) as { lat: number; lng: number }[];
    const pickupIndex = Number(route?.['pickupIndex']);
    const distance = Number(route?.['distanceMeters']);
    const started = await courier.service.startRoute(paid.id, courierId);
    clock.advance(60_000);
    await side.tour();
    const orderDocument = await raw
      .db(dbs.order)
      .collection<Document>(COLLECTIONS.ORDERS)
      .findOne({ _id: paid.id } as Document);

    expect(placed.map((p) => p.id)).toContain(courierId);
    expect(route?.['courierId']).toBe(courierId);
    expect(points.at(-1)).toEqual({ lat: QA_DELIVERY.lat, lng: QA_DELIVERY.lng });
    expect(assigned?.deliveryLocation).toMatchObject({
      lat: QA_DELIVERY.lat,
      lng: QA_DELIVERY.lng,
    });
    expect(points[pickupIndex]).toEqual({ lat: QA_MARKET.lat, lng: QA_MARKET.lng });
    expect(route?.['etaSeconds']).toBe(
      Math.ceil((distance * 3_600) / (DEFAULT_COURIER_SPEED_KMH * 1_000)),
    );
    expect(Number(route?.['etaSeconds'])).toBeGreaterThan(0);
    expect(route?.['createdAt']).toEqual(new Date(QA_NOW_MS));
    expect(started?.alreadyStarted).toBe(true);
    expect(started?.startedAt).toEqual(new Date(QA_NOW_MS));
    expect(started?.route?.points).toEqual(points);
    expect(started?.route?.distanceMeters).toBe(distance);
    expect(Object.keys(orderDocument ?? {}).filter((key) => /route|eta/i.test(key))).toEqual([]);
    expect(await preparingEvents(raw, dbs.order, paid.id)).toBe(1);
    expect(await routes.countDocuments({})).toBe(1);
  });
});
