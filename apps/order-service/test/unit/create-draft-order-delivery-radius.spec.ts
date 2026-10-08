/**
 * CreateDraftOrder teslimat yaricapi (#203): teslimat adresi acik marketin
 * yaricapi disindaysa taslak ACILMAZ. NO_STORE (404), ayrinti YALNIZCA
 * { reason: "OUT_OF_RANGE" } (mesafe ve konum yankilanmaz). Kural catalog
 * kapsamasiyla ortak (@getir/core; sinir DAHIL). Sira: kapali market -> yaricap
 * -> fiyat -> stok kilidi. Catalog ve inventory sahtedir.
 */

import {
  AppError,
  distanceMeters,
  ERROR_CODES,
  fixedClock,
  ORDER_STATUS,
  silentLogger,
} from '@getir/core';
import { recordingLogger } from '@getir/core/testing';
import type { LogLine } from '@getir/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import type { CreateDraftOrderInput } from '../../src/application/create-draft-order.js';
import {
  FAKE_MARKET_ID,
  FAKE_MARKET_LOCATION,
  FAKE_RADIUS_METERS,
} from '../support/fake-catalog-pricing.js';
import { draftHarness, rejectionOf } from '../support/draft-order-harness.js';
import type { DraftHarness } from '../support/draft-order-harness.js';
import { DRAFT_TOTAL_MINOR } from '../support/order-fixtures.js';

const clock = fixedClock(1_760_000_000_000);
const scope = { requestId: 'req_yaricap_1', logger: silentLogger };

/** Marketten ~1,8 km kuzeybatida (Kadikoy); 2,5 km yaricapin icinde. */
const NEARBY = { lat: 41.0, lng: 29.02 };
/** Marketten ~11,7 km kuzeyde: 2,5 km yaricapin disinda. */
const FAR = { lat: 41.09, lng: 29.02 };

const input: CreateDraftOrderInput = {
  userId: 'usr_1',
  marketId: FAKE_MARKET_ID,
  lines: [{ productId: 'prd_01', sku: 'SUT-1L', quantity: 2 }],
  deliveryLocation: NEARBY,
  deliveryAddress: 'Kadıköy',
  expectedTotalMinor: DRAFT_TOTAL_MINOR,
};

let h: DraftHarness;

beforeEach(() => {
  h = draftHarness(clock);
});

describe('CreateDraftOrder: teslimat yaricapi (#203)', () => {
  it('sinir DAHIL: mesafe == yaricap taslak acar; 1 m kisa yaricap OUT_OF_RANGE', async () => {
    const distance = distanceMeters(FAKE_MARKET_LOCATION, NEARBY);
    h.catalog.radiusMeters = distance;
    const atBoundary = await h.useCase()(input, scope);

    h.catalog.radiusMeters = distance - 1;
    const error = await rejectionOf(h.useCase()(input, scope));

    expect(atBoundary.status).toBe(ORDER_STATUS.DRAFT);
    expect(error.code).toBe(ERROR_CODES.NO_STORE);
    expect(error.details).toEqual({ reason: 'OUT_OF_RANGE' });
  });

  it('yaricap disi: ayrinti YALNIZCA sebep; taslak, olay ve stok kilidi YOK', async () => {
    const error = await rejectionOf(h.useCase()({ ...input, deliveryLocation: FAR }, scope));

    expect(error.code).toBe(ERROR_CODES.NO_STORE);
    expect(error.details).toEqual({ reason: 'OUT_OF_RANGE' });
    expect(JSON.stringify(error.details)).not.toMatch(/41\.09|29\.02|lat|lng/);
    expect(h.repository.size).toBe(0);
    expect(h.repository.recordedEvents).toEqual([]);
    expect(h.stock.reserves).toEqual([]);
  });

  it('kapali market ONCE gelir: kapali + yaricap disi -> STORE_CLOSED', async () => {
    h.catalog.closedMarketIds.add(FAKE_MARKET_ID);

    const error = await rejectionOf(h.useCase()({ ...input, deliveryLocation: FAR }, scope));

    expect(error.details).toEqual({ reason: 'STORE_CLOSED' });
  });

  it('fiyat degisiminden (PRICE_CHANGED) ONCE gelir', async () => {
    const changedTotal = { ...input, expectedTotalMinor: 100 };
    // Denetim: ayni girdi yaricap icinde gercekten PRICE_CHANGED verir.
    const inRange = await rejectionOf(h.useCase()(changedTotal, scope));

    const outOfRange = await rejectionOf(
      h.useCase()({ ...changedTotal, deliveryLocation: FAR }, scope),
    );

    expect(inRange.code).toBe(ERROR_CODES.PRICE_CHANGED);
    expect(outOfRange.details).toEqual({ reason: 'OUT_OF_RANGE' });
  });

  it('minimum sepetten (MIN_BASKET_NOT_MET) ve teklif okumasinin hatasindan ONCE gelir', async () => {
    const belowMinimum = {
      ...input,
      lines: [{ productId: 'prd_02', sku: 'EKMEK-1', quantity: 1 }],
      expectedTotalMinor: 1_000,
    };
    // Denetim: ayni sepet yaricap icinde gercekten MIN_BASKET_NOT_MET verir.
    const inRange = await rejectionOf(h.useCase()(belowMinimum, scope));
    const smallBasket = await rejectionOf(
      h.useCase()({ ...belowMinimum, deliveryLocation: FAR }, scope),
    );
    h.catalog.offersFailure = new AppError(ERROR_CODES.SERVICE_UNAVAILABLE, 'teklifler yok');
    const offersDown = await rejectionOf(h.useCase()({ ...input, deliveryLocation: FAR }, scope));

    expect(inRange.code).toBe(ERROR_CODES.MIN_BASKET_NOT_MET);
    expect([smallBasket.details, offersDown.details]).toEqual([
      { reason: 'OUT_OF_RANGE' },
      { reason: 'OUT_OF_RANGE' },
    ]);
    expect(h.stock.reserves).toEqual([]);
  });

  it('gunlukte yuvarlanmis mesafe ve yaricap var (sinir uyusmazligi ayirt edilir); koordinat YOK', async () => {
    const lines: LogLine[] = [];

    await rejectionOf(
      h.useCase()(
        { ...input, deliveryLocation: FAR },
        { requestId: 'req_yaricap_2', logger: recordingLogger(lines) },
      ),
    );

    const line = lines.find((entry) => entry.message === 'teslimat adresi yaricap disinda');
    expect(line?.fields).toEqual({
      marketId: FAKE_MARKET_ID,
      distanceMeters: Math.round(distanceMeters(FAKE_MARKET_LOCATION, FAR)),
      radiusMeters: FAKE_RADIUS_METERS,
    });
    expect(JSON.stringify(lines)).not.toMatch(/41\.09|29\.02|40\.985|29\.0275/);
  });

  it('kullanicinin onceki taslagi ve kilidi etkilenmez', async () => {
    const previous = await h.useCase()(input, scope);

    const error = await rejectionOf(h.useCase()({ ...input, deliveryLocation: FAR }, scope));

    expect(error.details).toEqual({ reason: 'OUT_OF_RANGE' });
    const kept = await h.repository.findById(previous.id);
    expect(kept?.status).toBe(ORDER_STATUS.DRAFT);
    expect(h.stock.stateOf(previous.id)).toBe('held');
    expect(h.stock.releases).toEqual([]);
    expect(h.stock.reserves.map((request) => request.orderId)).toEqual([previous.id]);
  });
});
