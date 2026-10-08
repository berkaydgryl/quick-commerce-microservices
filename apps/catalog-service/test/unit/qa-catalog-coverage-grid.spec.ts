/**
 * QA (T15.2, catalog geriye donuk PR 1; CQ1 izgara): GERCEK fixture'da liste hicbir konumda
 * kesilmez. #219'dan beri liste once kapsamaya bakar, SONRA en yakin MARKET_CANDIDATE_LIMIT
 * kapsayan marketi alir; bir konumu kapsayan market sayisi sinirdan fazlaysa en uzaktakiler
 * listeye girmez. catalog-fixtures.spec yalnizca uc demo adresini sayar; burada marketlerin
 * cevresindeki butun izgara (100 m) taranir ve en kotu nokta raporlanir. Izgara noktalarinin
 * ARASINI da kapsamak icin bir market, yaricapi + hucrenin yarim kosegeni (~71 m) icindeyse
 * sayilir: bir hucrenin icindeki her nokta, en yakin izgara noktasina bu kadar yakindir (ust sinir).
 * Kapsamayan yakin market sayilmaz (#219 oncesinin varsayimi artik gerekmez).
 */

import { describe, expect, it } from 'vitest';

import { MARKET_CANDIDATE_LIMIT } from '../../src/config/constants.js';
import { CATALOG_SNAPSHOT } from '../../src/infrastructure/fixtures.js';
import { haversineMeters, offset } from '../support/qa-catalog-geo.js';

/** Izgara adimi (metre); tarama alani marketlerin cevresinde en buyuk yaricap kadar pay birakir. */
const STEP_METERS = 100;
/** Hucredeki herhangi bir noktanin en yakin izgara noktasina uzakligi en fazla yarim kosegen. */
const HALF_DIAGONAL_METERS = (STEP_METERS * Math.SQRT2) / 2;

describe('QA CQ1 izgara: gercek fixture, her konumda aday siniri yeter', () => {
  it('her konumda (izgara + yarim kosegen payi) kapsayan market sayisi aday sinirini asmaz: liste kesilmez', () => {
    const markets = CATALOG_SNAPSHOT.markets;
    const maxRadius = Math.max(...markets.map((market) => market.deliveryRadiusMeters));
    const south = Math.min(...markets.map((market) => market.lat));
    const north = Math.max(...markets.map((market) => market.lat));
    const west = Math.min(...markets.map((market) => market.lng));
    const east = Math.max(...markets.map((market) => market.lng));
    const corner = offset({ lat: south, lng: west }, -maxRadius, -maxRadius);
    const far = offset({ lat: north, lng: east }, maxRadius, maxRadius);
    const latStep = offset(corner, STEP_METERS, 0).lat - corner.lat;
    const lngStep = offset(corner, 0, STEP_METERS).lng - corner.lng;

    let worst = { count: 0, lat: 0, lng: 0 };
    let points = 0;
    for (let lat = corner.lat; lat <= far.lat; lat += latStep) {
      for (let lng = corner.lng; lng <= far.lng; lng += lngStep) {
        points += 1;
        const count = markets.filter(
          (market) =>
            haversineMeters({ lat, lng }, market) <=
            market.deliveryRadiusMeters + HALF_DIAGONAL_METERS,
        ).length;
        if (count > worst.count) worst = { count, lat, lng };
      }
    }

    // Tarama gercekten yapildi (bos izgara yanlis yesil vermesin) ve en kotu nokta raporlanir.
    expect(points).toBeGreaterThan(1_000);
    expect(
      worst.count,
      `en kotu nokta ${worst.lat.toFixed(4)},${worst.lng.toFixed(4)}: ${String(worst.count)} market`,
    ).toBeLessThanOrEqual(MARKET_CANDIDATE_LIMIT);
  });
});
