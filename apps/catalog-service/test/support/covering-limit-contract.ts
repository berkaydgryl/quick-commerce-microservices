/**
 * Aday siniri SOZLESME testi (#175): sinir kapsamadan SONRA uygulanir. Ayni
 * senaryolar bellekte (unit) ve gercek Mongo'da (integration) kosar.
 */

import { describe, expect, it } from 'vitest';

import { MARKET_CANDIDATE_LIMIT } from '../../src/config/constants.js';
import type { Market } from '../../src/domain/catalog.js';
import type { MarketReader } from '../../src/domain/market-reader.js';
import {
  coveringCrowd,
  CROWDED_POINT,
  crowdedMarkets,
  marketAt,
  nearNotCovering,
  northOf,
  WIDE_MARKET_ID,
} from './crowded-markets.js';

export type ReaderWith = (
  markets: readonly Market[],
) => Promise<Pick<MarketReader, 'listCoveringMarkets'>>;

export function describeCoveringLimitContract(name: string, readerWith: ReaderWith): void {
  describe(`aday siniri kapsamadan SONRA (#175): ${name}`, () => {
    it('21 yakin kapsamayan marketin arkasindaki genis yaricapli kapsayan market listede', async () => {
      const reader = await readerWith(crowdedMarkets());

      const covering = await reader.listCoveringMarkets(CROWDED_POINT, MARKET_CANDIDATE_LIMIT);

      expect(covering.map((entry) => entry.market.id)).toEqual([WIDE_MARKET_ID]);
    });

    it('sinir kapsayanlara uygulanir: araya serpilmis kapsamayanlar sayilmaz; 25 kapsayandan en yakin 20', async () => {
      const crowd = coveringCrowd(25);
      // Kapsayanlarin ARASINA yakin ama kapsamayan 10 market: sinir once
      // uygulansaydi 20 adayin bir kismi kapsamayan olur, 20 kapsayan donmezdi.
      const reader = await readerWith([...crowd, ...nearNotCovering(10)]);

      const covering = await reader.listCoveringMarkets(CROWDED_POINT, MARKET_CANDIDATE_LIMIT);

      expect(covering.map((entry) => entry.market.id)).toEqual(
        crowd.slice(0, MARKET_CANDIDATE_LIMIT).map((market) => market.id),
      );
    });

    it('yaricap sinirinin iki yani: mesafe <= yaricap listede, 1 m kisa yaricap listede yok', async () => {
      const location = northOf(CROWDED_POINT, 1_000);
      // Okuyucunun KENDI olctugu mesafe (Mongo ve bellek ayni formul, +-1 m).
      const probe = await readerWith([marketAt('mkt_sinir', location, 10_000)]);
      const measured = (await probe.listCoveringMarkets(CROWDED_POINT, 1))[0]?.distanceMeters;
      expect(measured).toBeDefined();
      const edge = Math.ceil(measured ?? Number.NaN);

      // Her okuyucu yazildigi anda sorulur: Mongo'da hepsi AYNI koleksiyondur.
      const atEdge = await readerWith([marketAt('mkt_sinir', location, edge)]);
      expect(
        (await atEdge.listCoveringMarkets(CROWDED_POINT, 1)).map((entry) => entry.market.id),
      ).toEqual(['mkt_sinir']);
      const short = await readerWith([marketAt('mkt_sinir', location, edge - 1)]);
      expect(await short.listCoveringMarkets(CROWDED_POINT, 1)).toEqual([]);
    });
  });
}
