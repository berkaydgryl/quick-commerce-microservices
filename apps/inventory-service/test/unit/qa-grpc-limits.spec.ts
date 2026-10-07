/**
 * QA kara kutu (T15.2 geriye donuk tur, inventory PR 2; IQ7): gRPC SINIRLARI tel uzerinden.
 * Sema kurallari test/unit/schemas.spec.ts'te; burada gercek sunucu (bellekteki demo stogu,
 * sabit saat) ile iki sey:
 *
 *   - Sinirin bir ustu INVALID_ARGUMENT / VALIDATION_FAILED doner, alan adiyla; ASLA INTERNAL.
 *     Sinirin kendisi dogrulamadan GECER (stok kurali konusur).
 *   - Reddedilen istek IZ BIRAKMAZ: musaitlik ayni; ayni siparis ve kullanici ardindan TAZE
 *     rezervasyon alir (kayit da kullanici kilidi de yok). Reddedilen uzatma hak TUKETMEZ,
 *     reddedilen kisaltma ve birakma rezervasyona dokunmaz.
 */

import {
  CART_ITEM_MAX_QUANTITY,
  CART_MAX_ITEMS,
  RELEASE_REASON_MAX_LENGTH,
} from '@getir/contracts';
import { ERROR_CODES, fixedClock, GRPC_STATUS } from '@getir/core';
import { inventoryV1 } from '@getir/proto';
import { appErrorOf } from '@getir/service-kit/testing';
import type { ServiceError } from '@grpc/grpc-js';
import { describe, expect, it } from 'vitest';

import {
  DEFAULT_RESERVATION_MAX_EXTENSIONS,
  RESERVATION_EXTEND_MAX_SECONDS,
  RESERVATION_TTL_MAX_SECONDS,
  RESERVATION_TTL_MIN_SECONDS,
} from '../../src/config/constants.js';
import { useInventoryGrpcServer } from '../support/inventory-grpc-harness.js';

const NOW = Date.UTC(2026, 9, 7, 9, 0, 0);
const MARKET = 'mkt_migros-jet-moda';
/** Demo stogunda 24 adet (fixtures/stock-levels.ts); sinir testleri bunu tuketmez. */
const SKU = 'SUT-1L';
const OTHER_SKU = 'YUMURTA-10';
const TTL_SECONDS = 600;
const INT32_MAX = 2_147_483_647;
const INT32_MIN = -2_147_483_648;
const service = inventoryV1.InventoryServiceService;
const call = useInventoryGrpcServer(() => ({ clock: fixedClock(NOW) }));

type Item = { readonly sku: string; readonly quantity: number };

let counter = 0;
/** Her senaryo kendi siparisi ve kullanicisi: biri digerinin kilidine takilmasin. */
function nextIds(): { readonly orderId: string; readonly userId: string } {
  counter += 1;
  const hex = (0x9a000 + counter).toString(16).padStart(32, '0');
  return { orderId: `ord_${hex}`, userId: `usr_${hex}` };
}

const at = (offsetSeconds: number) => new Date(NOW + offsetSeconds * 1_000);

function reserve(
  ids: { readonly orderId: string; readonly userId: string },
  override: Partial<inventoryV1.ReserveRequest> = {},
) {
  return call(
    service.reserve,
    inventoryV1.ReserveRequest.fromPartial({
      orderId: ids.orderId,
      userId: ids.userId,
      marketId: MARKET,
      items: [{ sku: SKU, quantity: 1 }],
      ttlSeconds: TTL_SECONDS,
      ...override,
    }),
  );
}

function release(orderId: string, reason = 'user_cancelled') {
  return call(
    service.release,
    inventoryV1.ReleaseRequest.fromPartial({ orderId, marketId: MARKET, reason }),
  );
}

async function available(sku = SKU): Promise<number> {
  const { response } = await call(service.checkAvailability, {
    darkStoreId: '',
    marketId: MARKET,
    skus: [sku],
  });
  const quantity = response?.items[0]?.availableQuantity;
  if (quantity === undefined) throw new Error(`musaitlik okunamadi: ${sku}`);
  return quantity;
}

/** INVALID_ARGUMENT / VALIDATION_FAILED ve beklenen alan; INTERNAL ya da baska kod duser. */
function expectRejected(error: ServiceError | undefined, field: string): void {
  expect(error?.code).toBe(GRPC_STATUS.INVALID_ARGUMENT);
  const appError = appErrorOf(error);
  expect(appError?.code).toBe(ERROR_CODES.VALIDATION_FAILED);
  expect(Object.keys(appError?.details ?? {})).toContain(field);
}

/**
 * Iz yok: ayni siparis ve kullanici simdi TAZE rezervasyon alir (kayit yok, kilit yok),
 * sonra birakilir; musaitlik basa doner.
 */
async function expectNoTrace(
  ids: { readonly orderId: string; readonly userId: string },
  before: number,
): Promise<void> {
  expect(await available()).toBe(before);
  const probe = await reserve(ids);
  expect(probe.error).toBeUndefined();
  expect(probe.response?.alreadyReserved).toBe(false);
  expect((await release(ids.orderId)).error).toBeUndefined();
  expect(await available()).toBe(before);
}

const many = (count: number): Item[] =>
  Array.from({ length: count }, (_, index) => ({ sku: `QA-SINIR-${index}`, quantity: 1 }));

describe('QA IQ7 Reserve sinirlari: tel uzerinde VALIDATION_FAILED ve iz yok', () => {
  it.each<[string, Partial<inventoryV1.ReserveRequest>, string]>([
    [`${CART_MAX_ITEMS + 1} kalem`, { items: many(CART_MAX_ITEMS + 1) }, 'items'],
    ['bos kalem listesi', { items: [] }, 'items'],
    [
      `adet ${CART_ITEM_MAX_QUANTITY + 1}`,
      { items: [{ sku: SKU, quantity: CART_ITEM_MAX_QUANTITY + 1 }] },
      'items.0.quantity',
    ],
    ['adet 0', { items: [{ sku: SKU, quantity: 0 }] }, 'items.0.quantity'],
    ['adet -1', { items: [{ sku: SKU, quantity: -1 }] }, 'items.0.quantity'],
    ['adet int32 ust siniri', { items: [{ sku: SKU, quantity: INT32_MAX }] }, 'items.0.quantity'],
    ['adet int32 alt siniri', { items: [{ sku: SKU, quantity: INT32_MIN }] }, 'items.0.quantity'],
    [
      'ilk kalem gecerli, ikincisi sinir disi (kismi rezervasyon yok)',
      {
        items: [
          { sku: SKU, quantity: 1 },
          { sku: OTHER_SKU, quantity: CART_ITEM_MAX_QUANTITY + 1 },
        ],
      },
      'items.1.quantity',
    ],
    [
      'ayni SKU iki kez',
      {
        items: [
          { sku: SKU, quantity: 1 },
          { sku: SKU, quantity: 1 },
        ],
      },
      'items',
    ],
    [
      `sure ${RESERVATION_TTL_MIN_SECONDS - 1} sn`,
      { ttlSeconds: RESERVATION_TTL_MIN_SECONDS - 1 },
      'ttlSeconds',
    ],
    [
      `sure ${RESERVATION_TTL_MAX_SECONDS + 1} sn`,
      { ttlSeconds: RESERVATION_TTL_MAX_SECONDS + 1 },
      'ttlSeconds',
    ],
    ['sure int32 ust siniri', { ttlSeconds: INT32_MAX }, 'ttlSeconds'],
    ['sure negatif', { ttlSeconds: -1 }, 'ttlSeconds'],
  ])('%s: reddedilir, stok ve kullanici kilidi degismez', async (_name, override, field) => {
    const ids = nextIds();
    const before = await available();
    const otherBefore = await available(OTHER_SKU);

    const { error } = await reserve(ids, override);

    expectRejected(error, field);
    expect(await available(OTHER_SKU)).toBe(otherBefore);
    await expectNoTrace(ids, before);
  });

  it(`sinirlarin KENDISI dogrulamadan gecer: ${CART_MAX_ITEMS} kalem ve adet ${CART_ITEM_MAX_QUANTITY} stok kuralina takilir`, async () => {
    const ids = nextIds();
    const before = await available();

    // Bilinmeyen SKU'larin sayaci yok: dogrulama gecti, stok konustu.
    const manyItems = await reserve(ids, { items: many(CART_MAX_ITEMS) });
    expect(manyItems.error?.code).toBe(GRPC_STATUS.FAILED_PRECONDITION);
    expect(appErrorOf(manyItems.error)?.code).toBe(ERROR_CODES.STOCK_INSUFFICIENT);

    // Demo stogu 24: en buyuk adet dogrulamadan gecer, yetersizlikle doner.
    const maxQuantity = await reserve(ids, {
      items: [{ sku: SKU, quantity: CART_ITEM_MAX_QUANTITY }],
    });
    expect(appErrorOf(maxQuantity.error)?.code).toBe(ERROR_CODES.STOCK_INSUFFICIENT);

    await expectNoTrace(ids, before);
  });

  it.each([RESERVATION_TTL_MIN_SECONDS, RESERVATION_TTL_MAX_SECONDS])(
    'sure %i sn sinirda kabul edilir; bitis = simdi + sure',
    async (ttlSeconds) => {
      const ids = nextIds();
      const before = await available();

      const { response, error } = await reserve(ids, { ttlSeconds });

      expect(error).toBeUndefined();
      expect(response).toEqual({ expiresAt: at(ttlSeconds), alreadyReserved: false });
      expect(await available()).toBe(before - 1);
      await release(ids.orderId);
      expect(await available()).toBe(before);
    },
  );
});

describe('QA IQ7 reddedilen degisiklik rezervasyona dokunmaz', () => {
  function extend(orderId: string, additionalSeconds: number) {
    return call(
      service.extendReservation,
      inventoryV1.ExtendReservationRequest.fromPartial({
        orderId,
        marketId: MARKET,
        additionalSeconds,
      }),
    );
  }

  function shorten(orderId: string, maxRemainingSeconds: number) {
    return call(
      service.shortenReservation,
      inventoryV1.ShortenReservationRequest.fromPartial({
        orderId,
        marketId: MARKET,
        maxRemainingSeconds,
      }),
    );
  }

  it('reddedilen uzatma hak TUKETMEZ ve bitisi oynatmaz: ardindan butun haklar kullanilir', async () => {
    const ids = nextIds();
    await reserve(ids);

    for (const additionalSeconds of [0, -60, RESERVATION_EXTEND_MAX_SECONDS + 1, INT32_MAX]) {
      expectRejected((await extend(ids.orderId, additionalSeconds)).error, 'additionalSeconds');
    }

    for (let count = 1; count <= DEFAULT_RESERVATION_MAX_EXTENSIONS; count += 1) {
      expect((await extend(ids.orderId, 60)).response).toEqual({
        expiresAt: at(TTL_SECONDS + count * 60),
        alreadyExtended: false,
        extensionCount: count,
        // Beklenen bitis gonderilmedi (T15.3 denetimi yok): uzatma gercekten yapildi.
        expiryMismatch: false,
      });
    }
    expect((await extend(ids.orderId, 60)).response?.alreadyExtended).toBe(true);
    await release(ids.orderId);
  });

  it('reddedilen kisaltma bitisi oynatmaz: ardindan gecerli kisaltma tam sureden iner', async () => {
    const ids = nextIds();
    await reserve(ids);

    for (const seconds of [
      RESERVATION_TTL_MIN_SECONDS - 1,
      0,
      RESERVATION_TTL_MAX_SECONDS + 1,
      INT32_MAX,
    ]) {
      expectRejected((await shorten(ids.orderId, seconds)).error, 'maxRemainingSeconds');
    }

    // 29 sn uygulanmis olsaydi 300'e kisaltma "zaten altinda" (shortened=false, 29) derdi.
    expect((await shorten(ids.orderId, 300)).response).toEqual({
      expiresAt: at(300),
      shortened: true,
    });
    await release(ids.orderId);
  });

  it('reddedilen birakma ve onay rezervasyonu ve stogu yerinde birakir', async () => {
    const ids = nextIds();
    const before = await available();
    await reserve(ids);

    for (const reason of [
      '',
      'USER_CANCELLED',
      'kullanici iptal',
      'a'.repeat(RELEASE_REASON_MAX_LENGTH + 1),
    ]) {
      expectRejected((await release(ids.orderId, reason)).error, 'reason');
    }
    const commit = await call(
      service.commit,
      inventoryV1.CommitRequest.fromPartial({ orderId: ids.orderId, marketId: '' }),
    );
    expectRejected(commit.error, 'marketId');

    expect(await available()).toBe(before - 1);
    // Rezervasyon duruyor: ayni siparis "zaten rezerve" ve ilk bitis.
    expect((await reserve(ids)).response).toEqual({
      expiresAt: at(TTL_SECONDS),
      alreadyReserved: true,
    });
    await release(ids.orderId);
    expect(await available()).toBe(before);
  });
});
