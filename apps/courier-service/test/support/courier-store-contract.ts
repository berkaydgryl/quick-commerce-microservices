/**
 * couriers deposu SOZLESME testi: ayni senaryolar bellekte (unit) ve gercek
 * Mongo'da (integration). Her test kendi kuryeleriyle baslar (setup
 * koleksiyonu bastan yazar). Market konumu kopyasi da ayni depodan okunur.
 *
 * Mesafeler kuzey yonunde kurulur (northOf): bellekte haversine, Mongo'da
 * $geoNear ayni sonucu verir. Dilim sinirlarina (300 m'nin katlari) en az
 * 50 m uzak tutulur; metrenin altindaki hesap farki sirayi degistirmesin.
 */

import { ERROR_CODES } from '@getir/core';
import { describe, expect, it } from 'vitest';

import { COURIER_STATUS } from '../../src/domain/courier.js';
import type { Courier } from '../../src/domain/courier.js';
import type { CarrierReader, CourierRepository } from '../../src/domain/courier-repository.js';
import type { MarketLocator } from '../../src/domain/market-locator.js';
import {
  courier,
  courierId,
  FAR_MARKET,
  FAR_MARKET_LOCATION,
  MARKET,
  MARKET_LOCATION,
  northOf,
  orderId,
  POOL_RULE,
  TEST_MARKETS,
} from './couriers.js';

export type StoreSetup = (
  couriers: readonly Courier[],
) => Promise<CourierRepository & CarrierReader & MarketLocator>;

const at = (minute: number): Date => new Date(Date.UTC(2026, 9, 4, 9, minute));

/** Yogun eszamanlilik: ayni noktada bos kurye, ayni anda talep, tekrar sayisi. */
const CROWD_COURIERS = 30;
const CROWD_CLAIMS = 20;
const CROWD_ROUNDS = 5;

/** MARKET'in `meters` kuzeyinde, `minute`'te bosta beklemeye baslamis IDLE kurye. */
const idleAt = (order: number, meters: number, minute: number): Courier =>
  courier(order, { lastLocation: northOf(MARKET_LOCATION, meters), idleSince: at(minute) });

export function describeCourierStoreContract(name: string, setup: StoreSetup): void {
  const claim = (store: CourierRepository, order: string, minute: number) =>
    store.claimNearest({ orderId: order, near: MARKET_LOCATION, rule: POOL_RULE, at: at(minute) });

  describe(`CourierRepository sozlesmesi: ${name}`, () => {
    it('kurye ALAN KAYBI olmadan okunur (konum ondalik kaybetmez); olmayan alan yok kalir', async () => {
      const busy = courier(1, {
        status: COURIER_STATUS.BUSY,
        currentOrderId: orderId(),
        lastAssignedAt: at(5),
        lastLocation: { lat: 40.985123, lng: 29.027456 },
      });
      const idle = courier(2, { idleSince: at(1) });
      const store = await setup([busy, idle]);

      expect(await store.findById(busy.id)).toEqual(busy);
      expect(await store.findById(idle.id)).toEqual(idle);
      expect(Object.keys((await store.findById(busy.id)) ?? {})).not.toContain('idleSince');
      expect(Object.keys((await store.findById(idle.id)) ?? {})).not.toContain('currentOrderId');
      expect(await store.findById(courierId(99))).toBeNull();
    });

    it('market konumu kopyadan okunur; bilinmeyen market null', async () => {
      const store = await setup([]);

      for (const market of TEST_MARKETS) {
        expect(await store.locate(market.marketId)).toEqual(market.location);
      }
      expect(await store.locate('mkt_boyle-bir-market-yok')).toBeNull();
    });

    it('havuz: yalnizca yaricap icindeki IDLE kurye; BUSY, OFFLINE ve 3 km disi atlanir; atanan BUSY, bosta beklemesi biter, konumu degismez', async () => {
      const store = await setup([
        courier(1, { status: COURIER_STATUS.OFFLINE }),
        courier(2, { status: COURIER_STATUS.BUSY, currentOrderId: orderId() }),
        idleAt(3, 3_100, 0),
        courier(4, { lastLocation: FAR_MARKET_LOCATION, idleSince: at(0) }),
        idleAt(5, 2_900, 30),
      ]);
      const order = orderId();

      const claimed = await claim(store, order, 40);

      expect(claimed).toEqual({
        ...courier(5, { lastLocation: northOf(MARKET_LOCATION, 2_900) }),
        status: COURIER_STATUS.BUSY,
        currentOrderId: order,
        lastAssignedAt: at(40),
      });
      expect(Object.keys(claimed ?? {})).not.toContain('idleSince');
      expect(await store.findById(courierId(5))).toEqual(claimed);
      expect(await store.findByOrder(order)).toEqual(claimed);
    });

    it('sira: 300 m dilim, dilim icinde en uzun suredir bosta, esitlikte kimlik; havuz bitince null', async () => {
      const store = await setup([
        idleAt(1, 100, 5), // dilim 0, yeni bosta
        idleAt(2, 250, 1), // dilim 0, en eski: once
        idleAt(3, 50, 3), // dilim 0
        idleAt(4, 400, 0), // dilim 1: dilim 0'dan sonra, en eski olsa da
        idleAt(6, 1_150, 2), // dilim 3, kimlik esitligi
        idleAt(5, 1_100, 2), // dilim 3, ayni an: kimligi kucuk once
        idleAt(7, 3_100, 0), // havuz disi
      ]);

      const picked: string[] = [];
      for (let index = 0; index < 7; index += 1) {
        picked.push((await claim(store, orderId(), 20 + index))?.id ?? 'yok');
      }

      expect(picked).toEqual([
        courierId(2),
        courierId(3),
        courierId(1),
        courierId(4),
        courierId(5),
        courierId(6),
        'yok',
      ]);
    });

    it(`yogun eszamanlilik: ${CROWD_COURIERS} bos kurye ayni noktada, ${CROWD_CLAIMS} talep ayni anda -> tam ${CROWD_CLAIMS} atama, hepsi farkli kurye, bos donus yok (${CROWD_ROUNDS} tur, QA O1)`, async () => {
      const ids = Array.from({ length: CROWD_COURIERS }, (_, index) => courierId(index + 1));
      for (let round = 0; round < CROWD_ROUNDS; round += 1) {
        // Ayni dilim, ayni bosta bekleme: butun talepler ayni ilk adaylari okur.
        const store = await setup(ids.map((_, index) => courier(index + 1)));

        const claimed = await Promise.all(
          Array.from({ length: CROWD_CLAIMS }, (_, index) => claim(store, orderId(), index)),
        );

        const picked = claimed.map((one) => one?.id ?? 'yok');
        expect(
          picked.filter((id) => id === 'yok'),
          `tur ${round}`,
        ).toEqual([]);
        expect(new Set(picked).size, `tur ${round}`).toBe(CROWD_CLAIMS);
        const states = await Promise.all(ids.map((id) => store.findById(id)));
        expect(
          states.filter((one) => one?.status === COURIER_STATUS.BUSY),
          `tur ${round}`,
        ).toHaveLength(CROWD_CLAIMS);
      }
    });

    it('baska semtin marketinde havuz baska: Besiktas siparisi Kadikoy kuryesini almaz', async () => {
      const store = await setup([idleAt(1, 100, 0)]);

      const claimed = await store.claimNearest({
        orderId: orderId(),
        near: FAR_MARKET_LOCATION,
        rule: POOL_RULE,
        at: at(1),
      });

      expect(claimed).toBeNull();
      expect(await store.locate(FAR_MARKET)).toEqual(FAR_MARKET_LOCATION);
      expect((await store.findById(courierId(1)))?.status).toBe(COURIER_STATUS.IDLE);
    });

    it('bos kurye yoksa null; hicbir kurye degismez', async () => {
      const couriers = [
        courier(1, { status: COURIER_STATUS.OFFLINE }),
        courier(2, { lastLocation: FAR_MARKET_LOCATION }),
      ];
      const store = await setup(couriers);

      expect(await claim(store, orderId(), 1)).toBeNull();
      expect(await store.findById(courierId(1))).toEqual(couriers[0]);
      expect(await store.findById(courierId(2))).toEqual(couriers[1]);
    });

    it('siparise baska kurye bagliyken ikinci atama CONFLICT; secilecek kurye degismez', async () => {
      const order = orderId();
      const holder = courier(1, {
        status: COURIER_STATUS.BUSY,
        currentOrderId: order,
        lastAssignedAt: at(1),
      });
      const store = await setup([holder, idleAt(2, 100, 0)]);

      await expect(claim(store, order, 2)).rejects.toMatchObject({ code: ERROR_CODES.CONFLICT });
      expect(await store.findById(courierId(2))).toEqual(idleAt(2, 100, 0));
      expect(await store.findByOrder(order)).toEqual(holder);
    });

    it('listCarrying (#205): yalnizca siparis tasiyanlar, siparis kimligine gore artan, sinirli, imlecten sonrasi', async () => {
      const [first, second, third] = [orderId(), orderId(), orderId()].sort() as [
        string,
        string,
        string,
      ];
      const carrying = (n: number, order: string) =>
        courier(n, { status: COURIER_STATUS.BUSY, currentOrderId: order, lastAssignedAt: at(n) });
      const store = await setup([
        carrying(1, third),
        courier(2),
        carrying(3, first),
        carrying(4, second),
      ]);
      const ids = async (limit: number, after?: string) =>
        (await store.listCarrying(limit, after)).map((entry) => entry.id);

      expect(await ids(10)).toEqual([courierId(3), courierId(4), courierId(1)]);
      expect(await ids(2)).toEqual([courierId(3), courierId(4)]);
      expect(await ids(2, second)).toEqual([courierId(1)]);
      expect(await ids(10, third)).toEqual([]);
    });

    it('birakma: IDLE olur, siparis bagi silinir, bosta bekleme birakma aninda baslar, son atama ani ve konum kalir; ikinci birakma null', async () => {
      const order = orderId();
      const location = northOf(MARKET_LOCATION, 700);
      const store = await setup([
        courier(1, {
          status: COURIER_STATUS.BUSY,
          currentOrderId: order,
          lastAssignedAt: at(3),
          lastLocation: location,
        }),
      ]);

      const released = await store.releaseByOrder(order, at(9));

      expect(released).toEqual(
        courier(1, { lastAssignedAt: at(3), idleSince: at(9), lastLocation: location }),
      );
      expect(Object.keys(released ?? {})).not.toContain('currentOrderId');
      expect(await store.findByOrder(order)).toBeNull();
      expect(await store.releaseByOrder(order, at(10))).toBeNull();
      expect(await store.releaseByOrder(orderId(), at(10))).toBeNull();
    });

    it('teslimatta birakma (T13.3): kurye TESLIMAT NOKTASINDA bosa cikar, konum ani teslim ani', async () => {
      const order = orderId();
      const dropoff = northOf(MARKET_LOCATION, 1_200);
      const store = await setup([
        courier(1, {
          status: COURIER_STATUS.BUSY,
          currentOrderId: order,
          lastAssignedAt: at(3),
          lastLocation: MARKET_LOCATION,
        }),
      ]);

      const released = await store.releaseByOrder(order, at(9), { location: dropoff });

      expect(released).toEqual(
        courier(1, {
          lastAssignedAt: at(3),
          idleSince: at(9),
          lastLocation: dropoff,
          lastLocationAt: at(9),
        }),
      );
      expect(await store.findById(courierId(1))).toEqual(released);
    });

    it('kurye kimligiyle birakma (T13.3 tick): siparisi BASKA kurye tasiyorsa birakilmaz, konum degismez', async () => {
      const order = orderId();
      const store = await setup([
        courier(1, { status: COURIER_STATUS.BUSY, currentOrderId: order, lastAssignedAt: at(3) }),
      ]);
      const before = await store.findById(courierId(1));

      const other = await store.releaseByOrder(order, at(9), {
        courierId: courierId(2),
        location: MARKET_LOCATION,
      });

      expect(other).toBeNull();
      expect(await store.findById(courierId(1))).toEqual(before);
      expect((await store.releaseByOrder(order, at(9), { courierId: courierId(1) }))?.status).toBe(
        COURIER_STATUS.IDLE,
      );
    });

    it('birakilan kurye diliminin sonuna gecer (#88); ayni siparis yeniden atanabilir', async () => {
      const store = await setup([idleAt(1, 100, 0), idleAt(2, 150, 1)]);
      const first = orderId();

      const a = await claim(store, first, 2);
      await store.releaseByOrder(first, at(3));
      const b = await claim(store, first, 4);

      expect(a?.id).toBe(courierId(1));
      expect(b?.id).toBe(courierId(2));
      expect((await store.findByOrder(first))?.id).toBe(courierId(2));
    });

    it('marketin kendi kimligi depoya tasinmaz: atama yalnizca konumla (MARKET sabiti yalnizca kopyada)', async () => {
      const store = await setup([idleAt(1, 100, 0)]);

      expect(await store.locate(MARKET)).toEqual(MARKET_LOCATION);
      expect(Object.keys((await store.findById(courierId(1))) ?? {})).not.toContain('marketId');
    });
  });
}
