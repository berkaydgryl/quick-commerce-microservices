/**
 * Yetim stok kilidi (T15.3; bekleyen is 126, QA IQ4): Reserve inventory'de
 * uygulanir ama cevabi kaybolursa taslak yazilmaz, kilit order'in bilmedigi
 * siparis adina kalir; kullanici kilit omru boyunca RESERVATION_ACTIVE alirdi.
 *
 *   (a) Reserve'in cevabi belirsiz -> ayni siparis icin telafi Release
 *       (draft_not_saved), sonra asil hata. Is sonuclarinda (stok yetmedi) yok.
 *   (b) Kilidin siparis KAYDI yok -> yalnizca yasi esigi astiysa (kilit omru -
 *       kalan omur) ve ayni marketteyse birakilir (stale_lock), bir kez yeniden
 *       denenir; genc kilit (es zamanli ikinci sekme), yasi bilinmeyen ya da
 *       baska marketteki kilit korunur. Birakma gunluk satiri ve sayacla gorunur.
 */

import { AppError, ERROR_CODES, fixedClock, ORDER_STATUS } from '@getir/core';
import { recordingLogger } from '@getir/core/testing';
import type { LogLine } from '@getir/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CreateDraftOrderInput } from '../../src/application/create-draft-order.js';
import { createCreateDraftOrder } from '../../src/application/create-draft-order.js';
import { SETTLEMENT } from '../../src/application/stock-reservations.js';
import { InMemoryOrderStore } from '../../src/infrastructure/memory/in-memory-order-store.js';
import { FAKE_MARKET_ID, FakeCatalogPricing } from '../support/fake-catalog-pricing.js';
import { FAKE_TTL_SECONDS, FakeStockReservations } from '../support/fake-stock-reservations.js';
import { insertDraft } from '../support/order-builders.js';
import { DRAFT_TOTAL_MINOR } from '../support/order-fixtures.js';

const clock = fixedClock(1_760_000_000_000);
const SECOND = 1_000;
const MIN_AGE_SECONDS = 30;
const ORPHAN_ID = 'ord_yetim';
const LINES = [{ sku: 'SUT-1L', quantity: 2 }];

const input: CreateDraftOrderInput = {
  userId: 'usr_1',
  marketId: FAKE_MARKET_ID,
  lines: [{ productId: 'prd_01', sku: 'SUT-1L', quantity: 2 }],
  deliveryLocation: { lat: 40.99, lng: 29.02 },
  deliveryAddress: 'Kadıköy',
  expectedTotalMinor: DRAFT_TOTAL_MINOR,
};

let repository: InMemoryOrderStore;
let stock: FakeStockReservations;
let logLines: LogLine[];
let scope: { requestId: string; logger: ReturnType<typeof recordingLogger> };
let orphansReleased: number;

beforeEach(() => {
  repository = new InMemoryOrderStore();
  stock = new FakeStockReservations(() => clock.now());
  logLines = [];
  scope = { requestId: 'req_yetim_1', logger: recordingLogger(logLines) };
  orphansReleased = 0;
});

const createDraft = createCreateDraftOrderWith();

function createCreateDraftOrderWith() {
  return (draftInput: CreateDraftOrderInput = input) =>
    createCreateDraftOrder({
      repository,
      history: repository,
      catalog: new FakeCatalogPricing(),
      stock,
      reservationTtlSeconds: FAKE_TTL_SECONDS,
      orphanLockMinAgeSeconds: MIN_AGE_SECONDS,
      onOrphanLockReleased: () => {
        orphansReleased += 1;
      },
      clock,
    })(draftInput, scope);
}

/** Kaydi olmayan kilit; `ageSeconds` once alinmis (kalan omur = omur - yas). */
function givenOrphanLock(ageSeconds: number): void {
  const expiresAt = new Date(clock.now() + (FAKE_TTL_SECONDS - ageSeconds) * SECOND);
  stock.hold(ORPHAN_ID, input.userId, LINES, expiresAt);
}

async function rejectionOf(promise: Promise<unknown>): Promise<AppError> {
  const error = await promise.then(
    () => undefined,
    (reason: unknown) => reason,
  );
  if (error instanceof AppError) return error;
  throw new Error('AppError beklenirdi');
}

describe('(a) Reserve cevabi belirsiz: telafi Release', () => {
  it('inventory kilidi aldi, cevap kayboldu: ayni siparis birakilir (draft_not_saved), asil hata doner; yeni sepet kilitlenir', async () => {
    const lost = new AppError(ERROR_CODES.SERVICE_UNAVAILABLE, 'inventory zaman asimi');
    const reserve = stock.reserve.bind(stock);
    vi.spyOn(stock, 'reserve').mockImplementationOnce(async (request) => {
      await reserve(request);
      throw lost;
    });

    const error = await rejectionOf(createDraft());

    expect(error).toBe(lost);
    const [attempt] = stock.reserves;
    expect(stock.releases).toEqual([
      { orderId: attempt?.orderId, marketId: FAKE_MARKET_ID, reason: 'draft_not_saved' },
    ]);
    expect(stock.stateOf(attempt?.orderId ?? '')).toBe('released');
    await expect(createDraft()).resolves.toMatchObject({ userId: input.userId });
  });

  it('telafi Release de basarisiz: Release hatasi yutulur, istemci Reserve hatasini alir', async () => {
    const lost = new AppError(ERROR_CODES.SERVICE_UNAVAILABLE, 'inventory zaman asimi');
    stock.reserveFailure = lost;
    stock.releaseFailure = new AppError(ERROR_CODES.SERVICE_UNAVAILABLE, 'release da yok');

    await expect(createDraft()).rejects.toBe(lost);

    expect(stock.releases).toHaveLength(1);
  });

  it('is sonucu (stok yetmedi) belirsiz DEGIL: telafi Release yok', async () => {
    stock.available.set('SUT-1L', 1);

    const error = await rejectionOf(createDraft());

    expect(error.code).toBe(ERROR_CODES.STOCK_INSUFFICIENT);
    expect(stock.releases).toEqual([]);
  });
});

describe('(b) kaydi olmayan (yetim) kilit', () => {
  it('esikten eski, ayni market: stale_lock ile birakilir, yeni sepet kilitlenir; sayac ve gunluk satiri', async () => {
    givenOrphanLock(MIN_AGE_SECONDS + 1);

    const draft = await createDraft();

    expect(stock.releases).toEqual([
      { orderId: ORPHAN_ID, marketId: FAKE_MARKET_ID, reason: 'stale_lock' },
    ]);
    expect(stock.stateOf(draft.id)).toBe('held');
    expect(orphansReleased).toBe(1);
    expect(logLines).toContainEqual(
      expect.objectContaining({
        level: 'warn',
        message: 'kaydi olmayan (yetim) stok kilidi birakildi',
        fields: expect.objectContaining({
          orphanOrderId: ORPHAN_ID,
          ageMs: (MIN_AGE_SECONDS + 1) * SECOND,
        }) as unknown,
      }) as unknown,
    );
  });

  it.each([
    ['genc (es zamanli ikinci sekme)', 5],
    ['tam esikte', MIN_AGE_SECONDS],
  ])('%s: dokunulmaz, RESERVATION_ACTIVE', async (_name, ageSeconds) => {
    givenOrphanLock(ageSeconds);

    const error = await rejectionOf(createDraft());

    expect(error.code).toBe(ERROR_CODES.RESERVATION_ACTIVE);
    expect(stock.releases).toEqual([]);
    expect(stock.stateOf(ORPHAN_ID)).toBe('held');
    expect(orphansReleased).toBe(0);
  });

  it('yasi bilinmiyor (eski inventory kalan omru gondermez): dokunulmaz', async () => {
    stock.omitsActiveExpiry = true;
    givenOrphanLock(FAKE_TTL_SECONDS - 1);

    const error = await rejectionOf(createDraft());

    expect(error.code).toBe(ERROR_CODES.RESERVATION_ACTIVE);
    expect(stock.releases).toEqual([]);
  });

  it('baska marketteki yetim (Release NOT_FOUND): yeniden denenmez, RESERVATION_ACTIVE; sayilmaz', async () => {
    givenOrphanLock(MIN_AGE_SECONDS + 1);
    vi.spyOn(stock, 'release').mockResolvedValueOnce(SETTLEMENT.NOT_FOUND);

    const error = await rejectionOf(createDraft());

    expect(error.code).toBe(ERROR_CODES.RESERVATION_ACTIVE);
    expect(stock.reserves).toHaveLength(1);
    expect(orphansReleased).toBe(0);
  });

  it('kilidin kaydi BASKA kullanicinin siparisi: yetim sayilmaz, dokunulmaz (kimlik yalniz inventory kilidinden)', async () => {
    const foreign = await insertDraft(repository, clock, {
      userId: 'usr_2',
      marketId: FAKE_MARKET_ID,
    });
    stock.hold(foreign.id, input.userId, LINES, new Date(clock.now()));

    const error = await rejectionOf(createDraft());

    expect(error.code).toBe(ERROR_CODES.RESERVATION_ACTIVE);
    expect(stock.releases).toEqual([]);
    expect((await repository.findById(foreign.id))?.status).toBe(ORDER_STATUS.DRAFT);
  });

  it('iki sekme ayni anda: ilkinin taslagi henuz yazilmamisken ikinci GENC kilidi birakmaz; ilk sepet tamamlanir', async () => {
    let openGate: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      openGate = resolve;
    });
    const insert = repository.insert.bind(repository);
    vi.spyOn(repository, 'insert').mockImplementationOnce(async (order, events) => {
      await gate;
      return insert(order, events);
    });

    const first = createDraft();
    await vi.waitFor(() => {
      expect(stock.reserves).toHaveLength(1);
    });
    const second = await rejectionOf(createDraft());
    openGate();
    const draft = await first;

    expect(second.code).toBe(ERROR_CODES.RESERVATION_ACTIVE);
    expect(stock.releases).toEqual([]);
    expect(stock.stateOf(draft.id)).toBe('held');
    expect(await repository.findById(draft.id)).not.toBeNull();
  });
});
