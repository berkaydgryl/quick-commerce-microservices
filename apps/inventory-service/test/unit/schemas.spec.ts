import { describe, expect, it } from 'vitest';

import {
  CART_ITEM_MAX_QUANTITY,
  CART_MAX_ITEMS,
  RELEASE_REASON_MAX_LENGTH,
} from '@getir/contracts';

import {
  MAX_AVAILABILITY_SKUS,
  RESERVATION_TTL_MAX_SECONDS,
  RESERVATION_TTL_MIN_SECONDS,
} from '../../src/config/constants.js';
import {
  checkAvailabilityRequestSchema,
  releaseRequestSchema,
  reserveRequestSchema,
} from '../../src/interfaces/grpc/schemas.js';

function problems(input: unknown): Record<string, string[] | undefined> {
  const result = checkAvailabilityRequestSchema.safeParse(input);
  return result.success ? {} : result.error.flatten().fieldErrors;
}

describe('CheckAvailability istek semasi', () => {
  it('gecerli istek: SKU lar kirpilir', () => {
    expect(
      checkAvailabilityRequestSchema.parse({ marketId: 'mkt_migros-jet-moda', skus: [' SUT-1L '] }),
    ).toEqual({ marketId: 'mkt_migros-jet-moda', skus: ['SUT-1L'] });
  });

  it('market zorunlu ve sozlesmenin biciminde', () => {
    expect(problems({ marketId: '', skus: [] }).marketId).toEqual(['zorunlu']);
    expect(problems({ marketId: 'migros', skus: [] }).marketId).toBeDefined();
  });

  it('deprecated dark_store_id okunmaz: market yerine gecmez, ciktiya girmez', () => {
    expect(problems({ darkStoreId: 'ds_kadikoy', marketId: '', skus: [] }).marketId).toEqual([
      'zorunlu',
    ]);
    const parsed = checkAvailabilityRequestSchema.parse({
      darkStoreId: 'ds_kadikoy',
      marketId: 'mkt_a101-caferaga',
      skus: [],
    });
    expect(Object.hasOwn(parsed, 'darkStoreId')).toBe(false);
  });

  it(`en fazla ${MAX_AVAILABILITY_SKUS} SKU; bos liste gecerli`, () => {
    const sku = (index: number): string => `SKU-${index}`;
    expect(problems({ marketId: 'mkt_a101-caferaga', skus: [] })).toEqual({});
    expect(
      problems({
        marketId: 'mkt_a101-caferaga',
        skus: Array.from({ length: MAX_AVAILABILITY_SKUS }, (_, i) => sku(i)),
      }),
    ).toEqual({});
    expect(
      problems({
        marketId: 'mkt_a101-caferaga',
        skus: Array.from({ length: MAX_AVAILABILITY_SKUS + 1 }, (_, i) => sku(i)),
      }).skus,
    ).toEqual([`en fazla ${MAX_AVAILABILITY_SKUS} sku`]);
  });

  it('bos SKU reddedilir; bicimi bozuk ama dolu SKU gecer (unknownSkus a duser)', () => {
    expect(problems({ marketId: 'mkt_a101-caferaga', skus: [''] }).skus).toBeDefined();
    expect(problems({ marketId: 'mkt_a101-caferaga', skus: ['sut 1l'] })).toEqual({});
  });
});

describe('Reserve istek semasi (T10.1)', () => {
  const valid = {
    orderId: 'ord_00000000000000000000000000000001',
    darkStoreId: '',
    marketId: 'mkt_migros-jet-moda',
    userId: 'usr_00000000000000000000000000000001',
    items: [
      { sku: 'SUT-1L', quantity: 2 },
      { sku: 'KOLA-1L', quantity: 1 },
    ],
    ttlSeconds: 600,
  };

  function reserveProblems(overrides: Record<string, unknown>) {
    const result = reserveRequestSchema.safeParse({ ...valid, ...overrides });
    return result.success ? {} : result.error.flatten().fieldErrors;
  }

  it('gecerli istek; deprecated dark_store_id ciktiya girmez', () => {
    const parsed = reserveRequestSchema.parse(valid);

    expect(parsed).toEqual({
      orderId: valid.orderId,
      marketId: valid.marketId,
      userId: valid.userId,
      items: valid.items,
      ttlSeconds: 600,
    });
  });

  it('siparis ve kullanici kimligi BICIMIYLE: ikisi de Redis anahtarina girer', () => {
    expect(reserveProblems({ orderId: '' }).orderId).toEqual(['zorunlu']);
    expect(reserveProblems({ orderId: 'ord_1' }).orderId).toEqual([
      'ord_ onekli kimlik bekleniyor',
    ]);
    expect(reserveProblems({ orderId: valid.userId }).orderId).toBeDefined();
    expect(reserveProblems({ userId: 'usr_x:y' }).userId).toEqual([
      'usr_ onekli kimlik bekleniyor',
    ]);
    expect(reserveProblems({ marketId: 'migros' }).marketId).toBeDefined();
  });

  it(`kalem: en az 1, en fazla ${CART_MAX_ITEMS}; ayni SKU iki kez reddedilir`, () => {
    const item = (index: number) => ({ sku: `SKU-${index}`, quantity: 1 });
    expect(reserveProblems({ items: [] }).items).toEqual(['en az 1 kalem']);
    expect(
      reserveProblems({ items: Array.from({ length: CART_MAX_ITEMS }, (_, i) => item(i)) }),
    ).toEqual({});
    expect(
      reserveProblems({ items: Array.from({ length: CART_MAX_ITEMS + 1 }, (_, i) => item(i)) })
        .items,
    ).toEqual([`en fazla ${CART_MAX_ITEMS} kalem`]);
    expect(
      reserveProblems({
        items: [
          { sku: 'SUT-1L', quantity: 1 },
          { sku: 'SUT-1L', quantity: 2 },
        ],
      }).items,
    ).toEqual(['ayni sku iki kez: SUT-1L']);
  });

  it(`adet tam sayi 1..${CART_ITEM_MAX_QUANTITY}; SKU bicimi kesin (okumadaki esneklik yok)`, () => {
    const withItem = (sku: string, quantity: number) =>
      reserveProblems({ items: [{ sku, quantity }] });
    expect(withItem('SUT-1L', 0)).not.toEqual({});
    expect(withItem('SUT-1L', CART_ITEM_MAX_QUANTITY + 1)).not.toEqual({});
    expect(withItem('SUT-1L', 1.5)).not.toEqual({});
    expect(withItem('SUT-1L', CART_ITEM_MAX_QUANTITY)).toEqual({});
    expect(withItem('sut 1l', 1)).not.toEqual({});
  });

  it(`sure ${RESERVATION_TTL_MIN_SECONDS}..${RESERVATION_TTL_MAX_SECONDS} saniye (koruma; karari order verir)`, () => {
    expect(reserveProblems({ ttlSeconds: 0 }).ttlSeconds).toEqual([
      `en az ${RESERVATION_TTL_MIN_SECONDS} saniye`,
    ]);
    expect(reserveProblems({ ttlSeconds: RESERVATION_TTL_MAX_SECONDS + 1 }).ttlSeconds).toEqual([
      `en fazla ${RESERVATION_TTL_MAX_SECONDS} saniye`,
    ]);
    expect(reserveProblems({ ttlSeconds: RESERVATION_TTL_MIN_SECONDS })).toEqual({});
    expect(reserveProblems({ ttlSeconds: 120 })).toEqual({});
  });
});

describe('Release istek semasi (T10.2)', () => {
  const valid = {
    orderId: 'ord_00000000000000000000000000000001',
    darkStoreId: '',
    marketId: 'mkt_migros-jet-moda',
    reason: 'user_cancelled',
  };

  function releaseProblems(overrides: Record<string, unknown>) {
    const result = releaseRequestSchema.safeParse({ ...valid, ...overrides });
    return result.success ? {} : result.error.flatten().fieldErrors;
  }

  it('gecerli istek; deprecated dark_store_id ciktiya girmez', () => {
    expect(releaseRequestSchema.parse(valid)).toEqual({
      orderId: valid.orderId,
      marketId: valid.marketId,
      reason: 'user_cancelled',
    });
  });

  it('siparis ve market zorunlu ve biciminde (Redis anahtarina girer)', () => {
    expect(releaseProblems({ orderId: '' }).orderId).toEqual(['zorunlu']);
    expect(releaseProblems({ orderId: 'ord_1' }).orderId).toEqual([
      'ord_ onekli kimlik bekleniyor',
    ]);
    expect(releaseProblems({ marketId: '' }).marketId).toEqual(['zorunlu']);
  });

  it(`gerekce kisa anahtar: kucuk harf, rakam, alt cizgi; en fazla ${RELEASE_REASON_MAX_LENGTH}`, () => {
    expect(releaseProblems({ reason: '' }).reason).toEqual(['zorunlu']);
    expect(releaseProblems({ reason: 'Kullanici iptal etti' }).reason).toEqual([
      'kucuk harf, rakam ve alt cizgiden olusan bir anahtar olmali',
    ]);
    expect(releaseProblems({ reason: 'user-cancelled' })).not.toEqual({});
    expect(releaseProblems({ reason: 'a'.repeat(RELEASE_REASON_MAX_LENGTH + 1) }).reason).toEqual([
      `en fazla ${RELEASE_REASON_MAX_LENGTH} karakter`,
    ]);
    expect(releaseProblems({ reason: 'a'.repeat(RELEASE_REASON_MAX_LENGTH) })).toEqual({});
    expect(releaseProblems({ reason: 'payment_failed_3ds' })).toEqual({});
  });
});
