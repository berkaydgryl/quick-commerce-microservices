/**
 * ListNearbyMarkets ve GetMarket (ADR-15), gercek gRPC sunucusu uzerinden.
 */

import { CURRENCY, ERROR_CODES, GRPC_STATUS } from '@getir/core';
import { catalogV1 } from '@getir/proto';
import { describe, expect, it } from 'vitest';

import { MIGROS_MODA } from '../../support/catalog-requests.js';
import { useCatalogGrpcServer } from '../../support/catalog-grpc-harness.js';
import { demoLocation, EXPECTED_NEARBY } from '../../support/demo-addresses.js';
import { appErrorOf } from '@getir/service-kit/testing';

const call = useCatalogGrpcServer();

describe('ListNearbyMarkets', () => {
  it('Ev: Kadikoy marketleri yakindan uzaga, TAM SAYI metre (mapper yuvarlar)', async () => {
    const { error, response } = await call(catalogV1.CatalogServiceService.listNearbyMarkets, {
      location: demoLocation('Ev'),
    });

    expect(error).toBeUndefined();
    expect(
      response?.markets.map((entry) => ({
        marketId: entry.market?.id,
        meters: entry.distanceMeters,
      })),
    ).toEqual(EXPECTED_NEARBY.Ev);
  });

  it('market bilgisi telde: puan TAM SAYI (47), kurallar kurus', async () => {
    const { response } = await call(catalogV1.CatalogServiceService.listNearbyMarkets, {
      location: demoLocation('Ev'),
    });
    const migros = response?.markets.find((entry) => entry.market?.id === MIGROS_MODA)?.market;

    expect(migros?.rating).toEqual({ averageTenths: 47, count: 1200 });
    expect(migros?.pricingRules?.minBasket).toEqual({ amountMinor: 4000, currency: CURRENCY });
    expect(migros?.deliveryTime).toEqual({ minMinutes: 15, maxMinutes: 25 });
    // T11.11: tur, kapak ve (07.10, gecici yazi logo) logo yolu telde; gateway mutlak adres kurar.
    expect(migros?.logoUrl).toBe('/img/market-logo/migros-jet.svg');
    expect(migros?.storeType).toBe(catalogV1.StoreType.STORE_TYPE_MARKET);
    expect(migros?.coverUrl).toBe('/img/market/market.jpg');
  });

  it('Yazlik: BOS liste - "bolgende market yok" hata degil', async () => {
    const { error, response } = await call(catalogV1.CatalogServiceService.listNearbyMarkets, {
      location: demoLocation('Yazlık'),
    });

    expect(error).toBeUndefined();
    expect(response?.markets).toEqual([]);
  });

  it('konum verilmezse INVALID_ARGUMENT - (0,0) gibi islenmez', async () => {
    const { error } = await call(catalogV1.CatalogServiceService.listNearbyMarkets, {});

    expect(error?.code).toBe(GRPC_STATUS.INVALID_ARGUMENT);
    expect(appErrorOf(error)).toEqual({
      code: ERROR_CODES.VALIDATION_FAILED,
      details: { location: 'zorunlu' },
    });
  });

  it('WGS84 disi konum: sebep Turkce (gateway details i aynen REST e gecirir, D6)', async () => {
    const { error } = await call(catalogV1.CatalogServiceService.listNearbyMarkets, {
      location: { lat: 95, lng: 29 },
    });

    expect(error?.code).toBe(GRPC_STATUS.INVALID_ARGUMENT);
    expect(appErrorOf(error)?.details).toEqual({
      'location.lat': 'enlem -90 ile 90 arasinda olmali',
    });
  });
});

describe('GetMarket', () => {
  it('kapali marketi de dondurur', async () => {
    const { response } = await call(catalogV1.CatalogServiceService.getMarket, {
      marketId: 'mkt_a101-abbasaga',
    });

    expect(response?.market?.isOpen).toBe(false);
  });

  it('bilinmeyen market NOT_FOUND', async () => {
    const { error } = await call(catalogV1.CatalogServiceService.getMarket, {
      marketId: 'mkt_yok',
    });

    expect(error?.code).toBe(GRPC_STATUS.NOT_FOUND);
    expect(appErrorOf(error)).toEqual({
      code: ERROR_CODES.NOT_FOUND,
      details: { marketId: 'mkt_yok' },
    });
  });

  it('bicimi bozuk kimlik: NOT_FOUND degil INVALID_ARGUMENT (D6)', async () => {
    const { error } = await call(catalogV1.CatalogServiceService.getMarket, {
      marketId: 'BAD!ID',
    });

    expect(error?.code).toBe(GRPC_STATUS.INVALID_ARGUMENT);
    expect(appErrorOf(error)).toEqual({
      code: ERROR_CODES.VALIDATION_FAILED,
      details: { marketId: 'mkt_ onekli kimlik bekleniyor' },
    });
  });
});
