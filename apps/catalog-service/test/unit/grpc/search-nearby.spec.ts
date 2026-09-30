/**
 * SearchNearby (T9.6: genel arama), gercek gRPC sunucusu uzerinden: sonuc
 * bicimi telde (tam sayi metre, teklif fiyati, toplam) ve dogrulama hatalari.
 */

import { CURRENCY, ERROR_CODES, GRPC_STATUS } from '@getir/core';
import { catalogV1 } from '@getir/proto';
import { appErrorOf } from '@getir/service-kit/testing';
import { describe, expect, it } from 'vitest';

import { MIGROS_MODA } from '../../support/catalog-requests.js';
import { useCatalogGrpcServer } from '../../support/catalog-grpc-harness.js';
import type { DemoAddressTitle } from '../../support/demo-addresses.js';
import { demoLocation } from '../../support/demo-addresses.js';

const call = useCatalogGrpcServer();

const searchNearby = (title: DemoAddressTitle, query: string) =>
  call(catalogV1.CatalogServiceService.searchNearby, { location: demoLocation(title), query });

const summary = (result: catalogV1.MarketSearchResult) => ({
  marketId: result.market?.market?.id,
  meters: result.market?.distanceMeters,
  isOpen: result.market?.market?.isOpen,
  nameMatched: result.marketNameMatched,
  skus: result.offers.map((offer) => offer.sku),
  total: result.totalOfferMatches,
});

describe('SearchNearby', () => {
  it('Ev "süt": yakindan uzaga, TAM SAYI metre, ilk teklifler ve toplam telde', async () => {
    const { error, response } = await searchNearby('Ev', 'süt');

    expect(error).toBeUndefined();
    expect(response?.results.map(summary)).toEqual([
      {
        marketId: 'mkt_a101-caferaga',
        meters: 216,
        isOpen: true,
        nameMatched: false,
        skus: ['CIKOLATA-80', 'SUT-1L'],
        total: 2,
      },
      {
        marketId: MIGROS_MODA,
        meters: 405,
        isOpen: true,
        nameMatched: false,
        skus: ['CIKOLATA-80', 'SUT-1L'],
        total: 2,
      },
    ]);
  });

  it('teklif fiyati o marketin (ADR-15): ayni sut A101 de 32,10 TL, Migros ta 34,90 TL', async () => {
    const { response } = await searchNearby('Ev', 'süt 1');

    expect(
      response?.results.map((result) => [result.market?.market?.id, result.offers[0]?.price]),
    ).toEqual([
      ['mkt_a101-caferaga', { amountMinor: 3210, currency: CURRENCY }],
      [MIGROS_MODA, { amountMinor: 3490, currency: CURRENCY }],
    ]);
  });

  it('Ev "su": market basina en fazla 3 teklif, toplam 4 (istemci "+1 urun daha" der)', async () => {
    const { response } = await searchNearby('Ev', 'su');

    expect(
      response?.results.map((result) => [result.offers.length, result.totalOfferMatches]),
    ).toEqual([
      [3, 4],
      [3, 4],
    ]);
  });

  it('Ev "migros": urunsuz market adi eslesmesi, bos teklif listesi ve 0', async () => {
    const { response } = await searchNearby('Ev', 'migros');

    expect(response?.results.map(summary)).toEqual([
      { marketId: MIGROS_MODA, meters: 405, isOpen: true, nameMatched: true, skus: [], total: 0 },
    ]);
  });

  it('Is "cips": kapali A101 Abbasaga en sonda, isOpen false', async () => {
    const { response } = await searchNearby('İş', 'cips');

    expect(response?.results.map((result) => result.market?.market?.isOpen)).toEqual([
      true,
      true,
      false,
    ]);
    expect(response?.results.at(-1)?.market?.market?.id).toBe('mkt_a101-abbasaga');
  });

  it('Yazlik: BOS sonuc - "bolgende market yok" hata degil', async () => {
    const { error, response } = await searchNearby('Yazlık', 'süt');

    expect(error).toBeUndefined();
    expect(response?.results).toEqual([]);
  });

  it('sorgu ZORUNLU: proto3 eksik alan "" gelir, bosluk da bos sayilir', async () => {
    for (const query of ['', '   ']) {
      const { error } = await searchNearby('Ev', query);

      expect(error?.code).toBe(GRPC_STATUS.INVALID_ARGUMENT);
      expect(appErrorOf(error)).toEqual({
        code: ERROR_CODES.VALIDATION_FAILED,
        details: { query: 'zorunlu' },
      });
    }
  });

  it('tek harf ve 64 ten uzun sorgu: ListProducts aramasiyla ayni kurallar, Turkce', async () => {
    expect(appErrorOf((await searchNearby('Ev', ' s ')).error)?.details).toEqual({
      query: 'en az 2 karakter olmali',
    });
    expect(appErrorOf((await searchNearby('Ev', 'a'.repeat(65))).error)?.details).toEqual({
      query: 'en fazla 64 karakter olmali',
    });
  });

  it('konum verilmezse INVALID_ARGUMENT - (0,0) gibi islenmez', async () => {
    const { error } = await call(catalogV1.CatalogServiceService.searchNearby, { query: 'süt' });

    expect(error?.code).toBe(GRPC_STATUS.INVALID_ARGUMENT);
    expect(appErrorOf(error)).toEqual({
      code: ERROR_CODES.VALIDATION_FAILED,
      details: { location: 'zorunlu' },
    });
  });
});
