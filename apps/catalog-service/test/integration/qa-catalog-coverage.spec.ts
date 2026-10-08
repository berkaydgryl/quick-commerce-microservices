/**
 * QA kara kutu (T15.2, catalog geriye donuk PR 1; CQ1): "bu konuma hangi marketler hizmet verir?"
 * GERCEK Mongo'da ($geoNear, 2dsphere) ve gercek gRPC'de; kahin testin kendi haversine'i (Mongo ile
 * ayni ekvator yaricapi), uretimin distanceMeters'ina (@getir/core) yaslanmaz.
 *
 *   K1 ozellik (sabit tohum): 18 rastgele market (aday siniri 20'nin altinda, varsayim gecerli) ve
 *      60 rastgele konum; liste = yaricapi icinde kalan marketler, yakindan uzaga, kapalilar dahil
 *      (isOpen), uzaklik metreye yuvarli.
 *   K2 sinirin iki yani: ayni noktada iki market, yaricaplari uzakligin hemen ustu (ceil) ve hemen
 *      alti (floor, ikisi de 1 m'den yakin); ustu listede, alti yok (yuvarlanmis uzaklikla karsilastirma
 *      da yakalanir). Kapali market listede kalir (isOpen false).
 *   K3 (#175, #219 ile duzeldi): aday siniri (MARKET_CANDIDATE_LIMIT = 20) kapsama suzgecinden
 *      SONRA uygulanir. Kontrol: 19 yakin, kapsamayan market varken genis yaricapli market listede.
 *      21 yakin (kapsamayan) market aday sinirini doldursa da konumu kapsayan genis market listede.
 *      #219 oncesi bu kol [] veriyordu ($limit kapsamadan once). Yalniz $geoNear maxDistance = en
 *      buyuk yaricap bunu duzeltmezdi: 21 yakin market de 3 km icinde.
 */

import type { GeoPoint } from '@getir/core';
import { catalogV1 } from '@getir/proto';
import type { TestGrpcServer } from '@getir/service-kit/testing';
import { describe, expect, it } from 'vitest';

import { MARKET_CANDIDATE_LIMIT } from '../../src/config/constants.js';
import type { Market } from '../../src/domain/catalog.js';
import { haversineMeters, offset, seededRandom } from '../support/qa-catalog-geo.js';
import { marketsOnly, syntheticMarket, useCatalogWorld } from '../support/qa-catalog-world.js';

const world = useCatalogWorld('qa_catalog_kapsama');
const CENTER: GeoPoint = { lat: 41.03, lng: 29.0 };
const SEED = 0xca7a10;
const MARKETS = 18;
const QUERIES = 60;
const SPREAD_METERS = 4_000;
const RADIUS_MIN_METERS = 500;
const RADIUS_SPAN_METERS = 2_500;
const OPEN_SHARE = 0.8;

async function nearby(server: TestGrpcServer | undefined, location: GeoPoint) {
  if (server === undefined) throw new Error('catalog kopyasi yok');
  const { response, error } = await server.call(catalogV1.CatalogServiceService.listNearbyMarkets, {
    location,
  });
  if (response === undefined) throw new Error(`liste okunamadi: ${error?.message ?? ''}`);
  return response.markets.map((entry) => ({
    id: entry.market?.id ?? '',
    isOpen: entry.market?.isOpen ?? false,
    distanceMeters: entry.distanceMeters,
  }));
}

/** Kahin: yaricapi icinde kalanlar, yakindan uzaga. */
function covering(markets: readonly Market[], location: GeoPoint) {
  return markets
    .map((market) => ({ market, distance: haversineMeters(location, market) }))
    .filter(({ market, distance }) => distance <= market.deliveryRadiusMeters)
    .sort((left, right) => left.distance - right.distance)
    .map(({ market, distance }) => ({
      id: market.id,
      isOpen: market.isOpen,
      distanceMeters: Math.round(distance),
    }));
}

const around = (random: () => number, spread: number): GeoPoint =>
  offset(CENTER, (random() * 2 - 1) * spread, (random() * 2 - 1) * spread);

describe('QA CQ1 kapsama: gercek Mongo $geoNear, bagimsiz kahin', () => {
  it('K1 ozellik: 18 market x 60 konum; liste = yaricapi icindekiler, yakindan uzaga, kapalilar dahil', async () => {
    const random = seededRandom(SEED);
    const markets = Array.from({ length: MARKETS }, (_, n) =>
      syntheticMarket(
        `k1-${String(n)}`,
        around(random, SPREAD_METERS),
        Math.round(RADIUS_MIN_METERS + random() * RADIUS_SPAN_METERS),
        random() < OPEN_SHARE,
      ),
    );
    expect(markets.length).toBeLessThan(MARKET_CANDIDATE_LIMIT);
    const [server] = await world.open(marketsOnly(markets));

    const mismatches: string[] = [];
    let listed = 0;
    for (let query = 0; query < QUERIES; query += 1) {
      const location = around(random, SPREAD_METERS + 1_000);
      const got = await nearby(server, location);
      const want = covering(markets, location);
      listed += want.length;
      // Uzaklik: Mongo ile kahin arasinda kayan nokta farki yuvarlamada 1 m oynatabilir.
      const same =
        got.length === want.length &&
        got.every(
          (entry, index) =>
            entry.id === want[index]?.id &&
            entry.isOpen === want[index]?.isOpen &&
            Math.abs(entry.distanceMeters - (want[index]?.distanceMeters ?? Number.NaN)) <= 1,
        );
      if (!same) mismatches.push(`${String(query)}: ${JSON.stringify({ got, want })}`);
    }
    expect(mismatches).toEqual([]);
    // Bos kume yanlis yesil vermesin: konumlarin cogu en az bir market gorur.
    expect(listed).toBeGreaterThan(QUERIES);
  });

  it('K2 sinirin iki yani: yaricap ceil(uzaklik) listede, floor(uzaklik) yok; kapali market listede kalir', async () => {
    const location = offset(CENTER, 1_234, -567);
    const distance = haversineMeters(location, CENTER);
    // Sinira 1 m'den yakin: yaricap ceil(d) (d'nin <1 m ustu) icerde, floor(d) (<1 m alti)
    // disarida. Mongo ile kahin farki ~1e-9 m; d'nin kesir payi (~0,01 m) bunun cok ustunde.
    expect(
      Math.min(distance - Math.floor(distance), Math.ceil(distance) - distance),
    ).toBeGreaterThan(0.001);
    const inside = syntheticMarket('k2-ic', CENTER, Math.ceil(distance));
    const outside = syntheticMarket('k2-dis', CENTER, Math.floor(distance));
    const closed = syntheticMarket('k2-kapali', offset(CENTER, 10, 0), 5_000, false);
    const [server] = await world.open(marketsOnly([inside, outside, closed]));

    const got = await nearby(server, location);
    expect(
      got.map(({ id, isOpen }) => ({ id, isOpen })).sort((a, b) => a.id.localeCompare(b.id)),
    ).toEqual(
      [
        { id: inside.id, isOpen: true },
        { id: closed.id, isOpen: false },
      ].sort((a, b) => a.id.localeCompare(b.id)),
    );
  });

  it('K3 #175: aday siniri kapsamadan sonra; 19 da 21 de yakin (kapsamayan) market varken genis market listede', async () => {
    const location = CENTER;
    // Yakinlar konuma 200-400 m'de, yaricaplari 100 m: hicbiri kapsamaz. Genis market 1,5 km'de, 3 km.
    const nearMarkets = (count: number, tag: string) =>
      Array.from({ length: count }, (_, n) =>
        syntheticMarket(`k3-${tag}-${String(n)}`, offset(location, 200 + n * 10, 0), 100),
      );
    const wide = syntheticMarket('k3-genis', offset(location, -1_500, 0), 3_000);

    // Kontrol: aday sinirinin icinde (19 yakin + genis = 20 aday) genis market listede.
    const few = nearMarkets(MARKET_CANDIDATE_LIMIT - 1, 'az');
    expect(covering([...few, wide], location).map(({ id }) => id)).toEqual([wide.id]);
    const [withinLimit] = await world.open(marketsOnly([...few, wide]));
    expect((await nearby(withinLimit, location)).map(({ id }) => id)).toEqual([wide.id]);

    // #175: 21 yakin aday sinirini doldurur; genis market konumu kapsadigi icin yine listede.
    const many = nearMarkets(MARKET_CANDIDATE_LIMIT + 1, 'cok');
    expect(covering([...many, wide], location).map(({ id }) => id)).toEqual([wide.id]);
    const [beyondLimit] = await world.open(marketsOnly([...many, wide]));
    expect((await nearby(beyondLimit, location)).map(({ id }) => id)).toEqual([wide.id]);
  });
});
