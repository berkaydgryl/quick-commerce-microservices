/**
 * QA kara kutu (#174): yolda iptalde birakilan kurye nerede bosa cikar. Gercek Mongo
 * (Testcontainers), uretimdeki acilisla courier kopyasi (qa-route-world.ts), gercek gRPC; tick
 * kosmaz (anlar rotanin zaman hesabindan). PM kararlari:
 *
 *   - konum = birakma anindaki routeProgress(rota, saat); ani = birakma (Q4 B2 qa-route-mongo'da);
 *   - rota bu atamaya ait degilse (baska kuryenin ya da onceki atamanin) konum DEGISMEZ
 *     (takipteki belongsToAssignment kurali);
 *   - hesap teslimi gecmis ama tick yazmamissa kurye ADRESTE bosa cikar;
 *   - kayitli alma var ve saat onun gerisindeyse MARKET noktasi (#217 tick'iyle ayni; onceki
 *     musterinin sokagi geri gelmez).
 *
 *   R1 paket alindiktan sonra: market -> adres dogrusunda; tekrar birakma bir sey yapmaz; rotasiz
 *      eski atamada (T13.2 PR 1) konum atama noktasi.
 *   R2 rota bu atamaya ait degil (baska kurye; atamadan once uretilmis): konum degismez. Ayni
 *      dunyada rotasi kendine ait ucuncu kurye YURUR (denetim: birakma rotayi gercekten okuyor).
 *   R3 hesap teslimi gecmis, tick yazmamis: konum adres.
 *   R4 kayitli alma, saat gerisinde: konum market noktasi (rota hesabi birinci bacak der).
 *
 * Bu testler courier #174 degisikligi gelene kadar KIRMIZIDIR (bilincli; ayni PR'da yesile doner).
 * Kirmiziyi kuryenin YURUMESI verir; "konum degismez" kollari (R1 rotasiz, R2 a/b) main'de de
 * dogrudur, #174'un yanlis rotayi okumasina karsi korumadir.
 */

import { fixedClock } from '@getir/core';
import type { Document } from 'mongodb';
import { describe, expect, it } from 'vitest';

import { DEFAULT_ORDER_PREP_SECONDS } from '../../src/config/constants.js';
import type { GeoPoint } from '../../src/domain/courier.js';
import {
  courier,
  DELIVERY,
  MARKET,
  MARKET_LOCATION,
  northOf,
  NOW_MS,
  orderId,
  SEEDED_AT,
} from '../support/couriers.js';
import { outcomeOf } from '../support/qa-courier-harness.js';
import type { QaCourierServer } from '../support/qa-courier-harness.js';
import {
  CURRENT_MOVEMENT,
  GEO_TOLERANCE_M,
  lastLocationOf,
  metersBetween,
  pointTowards,
  SPEED_MPS,
  useRouteWorld,
} from '../support/qa-route-world.js';

const SECOND = 1_000;
const world = useRouteWorld();

/** Taze veritabaninda verilen konumlardaki kuryeler ve tek courier kopyasi. */
async function opened(starts: readonly GeoPoint[]) {
  const dbName = world.freshDb();
  const clock = fixedClock(NOW_MS);
  await world.seed(
    dbName,
    starts.map((lastLocation, index) => courier(index + 1, { lastLocation })),
  );
  const service = await world.replica({ dbName, clock, name: 'courier-qa-174' });
  return { dbName, clock, service };
}

/** Siparisi atar ve atanan kuryeyi dondurur (esit uzaklikta kucuk kimlik once). */
async function assigned(service: QaCourierServer, holder: string): Promise<string> {
  const order = orderId();
  expect(outcomeOf(await service.assign(order, MARKET, DELIVERY))).toMatchObject({
    kind: 'atandi',
    courierId: holder,
  });
  return order;
}

describe('QA #174 birakilan kuryenin konumu (gercek Mongo + gercek gRPC)', () => {
  it('R1 paket alindiktan sonra ikinci bacakta; tekrar birakma bir sey yapmaz; rotasiz eski atamada konum ayni', async () => {
    const start = northOf(MARKET_LOCATION, 100);
    const { dbName, clock, service } = await opened([start, start]);
    const order = await assigned(service, courier(1).id);
    // T13.2 PR 1 donemi atamasi (rota yok): ikinci kurye ayni anda atanir; rotasi silinir.
    const legacy = await assigned(service, courier(2).id);
    await world.routesOf(dbName).deleteOne({ _id: legacy } as Document);
    expect(await world.movementOf(dbName, order)).toEqual(CURRENT_MOVEMENT);

    // Hazirlik (300 sn) birinci bacaktan (100 m) uzun: alma ani hazirligin sonu. 10 sn sonra kurye
    // ikinci bacakta; ikinci bacak 10 sn'den uzun (teslim edilmemis).
    expect(DEFAULT_ORDER_PREP_SECONDS).toBeGreaterThan(100 / SPEED_MPS);
    expect(metersBetween(MARKET_LOCATION, DELIVERY)).toBeGreaterThan(10 * SPEED_MPS);
    clock.advance((DEFAULT_ORDER_PREP_SECONDS + 10) * SECOND);
    const onLegTwo = await world.routePositionAt(dbName, order, clock.now());
    const releaseMs = clock.now();
    expect((await service.release(order)).response?.released).toBe(true);
    const parked = await lastLocationOf(service, courier(1).id);
    expect(parked).toEqual({ location: onLegTwo, at: new Date(releaseMs) });
    // Bagimsiz geometri: market -> adres dogrusunda marketten 10 sn x hiz uzaktaki nokta.
    const expected = pointTowards(MARKET_LOCATION, DELIVERY, 10 * SPEED_MPS);
    expect(metersBetween(parked.location, expected)).toBeLessThan(GEO_TOLERANCE_M);

    // Kurye artik bu siparisi tasimiyor: tekrar birakma bir sey yapmaz (tekrar guvenli).
    clock.advance(30 * SECOND);
    expect((await service.release(order)).response?.released).toBe(false);
    expect(await lastLocationOf(service, courier(1).id)).toEqual(parked);

    // Rotasiz eski atama: birakma konumu ve anini degistirmez (atama noktasi).
    expect((await service.release(legacy)).response?.released).toBe(true);
    expect(await lastLocationOf(service, courier(2).id)).toEqual({
      location: start,
      at: SEEDED_AT,
    });
  });

  it('R2 rota bu atamaya ait degil (baska kuryenin; atamadan once uretilmis): konum degismez', async () => {
    const start = northOf(MARKET_LOCATION, 600);
    const { dbName, clock, service } = await opened([start, start, start]);
    // a) Rota belgesi baska kuryeyi gosteriyor.
    const foreign = await assigned(service, courier(1).id);
    await world
      .routesOf(dbName)
      .updateOne({ _id: foreign } as Document, { $set: { courierId: courier(3).id } });
    // b) Kurye siparisi rota uretildikten SONRA yeniden almis (rota yenilenemedi): eski rota.
    const stale = await assigned(service, courier(2).id);
    await world.couriersOf(dbName).updateOne({ _id: courier(2).id } as Document, {
      $set: { lastAssignedAt: new Date(NOW_MS + SECOND) },
    });
    // Denetim: rotasi kendine ait ucuncu kurye ayni anda birinci bacakta yurur.
    const own = await assigned(service, courier(3).id);
    clock.advance(60 * SECOND);
    const ownAt = await world.routePositionAt(dbName, own, clock.now());
    expect(metersBetween(ownAt, start)).toBeGreaterThan(100);
    const releaseAt = new Date(clock.now());

    const released: Record<string, boolean | undefined> = {};
    const parked: Record<string, Awaited<ReturnType<typeof lastLocationOf>>> = {};
    for (const [label, order, holder] of [
      ['baska kurye', foreign, courier(1).id],
      ['eski rota', stale, courier(2).id],
      ['kendi rotasi', own, courier(3).id],
    ] as const) {
      released[label] = (await service.release(order)).response?.released;
      parked[label] = await lastLocationOf(service, holder);
    }

    // Uc kol birlikte: biri dusse de digerleri gorunur.
    expect(released).toEqual({ 'baska kurye': true, 'eski rota': true, 'kendi rotasi': true });
    expect(parked).toEqual({
      'baska kurye': { location: start, at: SEEDED_AT },
      'eski rota': { location: start, at: SEEDED_AT },
      'kendi rotasi': { location: ownAt, at: releaseAt },
    });
  });

  it('R3 hesap teslimi gecmis, tick yazmamis: kurye adreste bosa cikar', async () => {
    const start = northOf(MARKET_LOCATION, 100);
    const { dbName, clock, service } = await opened([start]);
    const order = await assigned(service, courier(1).id);
    // Alma: hazirligin sonu (300 sn); varis: + ikinci bacak / hiz. Ondan 60 sn sonra.
    const arrivalSeconds =
      DEFAULT_ORDER_PREP_SECONDS + metersBetween(MARKET_LOCATION, DELIVERY) / SPEED_MPS;
    clock.advance((Math.ceil(arrivalSeconds) + 60) * SECOND);
    expect(await world.routePositionAt(dbName, order, clock.now())).toEqual(DELIVERY);

    const releaseAt = new Date(clock.now());
    expect((await service.release(order)).response?.released).toBe(true);
    expect(await lastLocationOf(service, courier(1).id)).toEqual({
      location: DELIVERY,
      at: releaseAt,
    });
  });

  it('R4 kayitli alma var, saat onun gerisinde: konum market noktasi (rota hesabi birinci bacak der)', async () => {
    // Birinci bacak uzun (2 km): saat gerideyken hesabin konumu marketten belirgin uzak.
    const start = northOf(MARKET_LOCATION, 2_000);
    const { dbName, clock, service } = await opened([start]);
    const order = await assigned(service, courier(1).id);
    // Tick almayi ILERIDEKI bir anda kaydetmis gibi; saat 100. saniyede (kaydin gerisinde).
    await world.routesOf(dbName).updateOne({ _id: order } as Document, {
      $set: { pickedUpAt: new Date(NOW_MS + 400 * SECOND) },
    });
    clock.advance(100 * SECOND);
    const computed = await world.routePositionAt(dbName, order, clock.now());
    expect(metersBetween(computed, MARKET_LOCATION)).toBeGreaterThan(1_000);

    const releaseAt = new Date(clock.now());
    expect((await service.release(order)).response?.released).toBe(true);
    expect(await lastLocationOf(service, courier(1).id)).toEqual({
      location: MARKET_LOCATION,
      at: releaseAt,
    });
  });
});
