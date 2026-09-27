/**
 * CreateDraftOrder istek semasi: sepet, konum ve T7.2'nin fiyat alanlari
 * (beklenen toplam, kupon). Girdi proto'dan cozulmus bicimdir (draftRequest).
 */

import { CART_ITEM_MAX_QUANTITY, CART_MAX_ITEMS } from '@getir/contracts';
import { describe, expect, it } from 'vitest';

import { MAX_COUPON_CODE_LENGTH } from '../../../src/config/constants.js';
import { createDraftOrderRequestSchema } from '../../../src/interfaces/grpc/schemas.js';
import { DRAFT_TOTAL_MINOR, draftRequest } from '../../support/order-fixtures.js';

const accepts = (overrides: Record<string, unknown>): boolean =>
  createDraftOrderRequestSchema.safeParse({ ...draftRequest, ...overrides }).success;

const line = (productId: string, quantity = 1) => ({ productId, sku: 'SUT-1L', quantity });

describe('createDraftOrderRequestSchema: sepet ve konum', () => {
  it('gecerli istegi kabul eder', () => {
    expect(accepts({})).toBe(true);
  });

  it('bos sepeti reddeder', () => {
    expect(accepts({ lines: [] })).toBe(false);
  });

  it('gecersiz sku bicimini reddeder', () => {
    // SKU deseni @getir/core'da; Redis anahtarinda gectigi icin bosluk olamaz.
    expect(accepts({ lines: [{ productId: 'prd_01', sku: 'sut 1l', quantity: 1 }] })).toBe(false);
  });

  it('sifir ve negatif adedi reddeder', () => {
    expect(accepts({ lines: [line('prd_01', 0)] })).toBe(false);
    expect(accepts({ lines: [line('prd_01', -1)] })).toBe(false);
  });

  it('ayni urun iki satirda gelirse reddeder (hangi adet gecerli belirsiz)', () => {
    expect(accepts({ lines: [line('prd_01'), line('prd_01')] })).toBe(false);
  });

  it('sepet sinirlari sozlesmeyle ayni: kalem sayisi ve adet', () => {
    const lines = (count: number) =>
      Array.from({ length: count }, (_, index) => line(`prd_${index}`));

    expect(accepts({ lines: lines(CART_MAX_ITEMS) })).toBe(true);
    expect(accepts({ lines: lines(CART_MAX_ITEMS + 1) })).toBe(false);
    expect(accepts({ lines: [line('prd_01', CART_ITEM_MAX_QUANTITY)] })).toBe(true);
    expect(accepts({ lines: [line('prd_01', CART_ITEM_MAX_QUANTITY + 1)] })).toBe(false);
  });

  it('konum yoksa reddeder', () => {
    // proto3'te ic ice mesaj gonderilmezse undefined gelir; sessizce
    // (0,0) varsaymak siparisi Gine Korfezi'ne teslim ettirirdi.
    expect(accepts({ deliveryLocation: undefined })).toBe(false);
  });

  it('gecersiz enlem/boylami reddeder', () => {
    expect(accepts({ deliveryLocation: { lat: 95, lng: 29.02 } })).toBe(false);
  });
});

describe('createDraftOrderRequestSchema: beklenen toplam (T7.2)', () => {
  it('ZORUNLUDUR: gonderilmezse reddedilir (istemci kontrolu atlayamaz)', () => {
    const result = createDraftOrderRequestSchema.safeParse({
      ...draftRequest,
      expectedTotal: undefined,
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]).toMatchObject({ path: ['expectedTotal'], message: 'zorunlu' });
  });

  it('kurus cinsinden tam sayi ve negatif degil', () => {
    expect(accepts({ expectedTotal: { amountMinor: -1, currency: 'TRY' } })).toBe(false);
    expect(accepts({ expectedTotal: { amountMinor: 79.9, currency: 'TRY' } })).toBe(false);
  });

  it('bos para birimi sozlesme geregi TRY sayilir; baska birim reddedilir', () => {
    const parsed = createDraftOrderRequestSchema.parse({
      ...draftRequest,
      expectedTotal: { amountMinor: DRAFT_TOTAL_MINOR, currency: '' },
    });

    expect(parsed.expectedTotal).toEqual({ amountMinor: DRAFT_TOTAL_MINOR, currency: 'TRY' });
    expect(accepts({ expectedTotal: { amountMinor: DRAFT_TOTAL_MINOR, currency: 'USD' } })).toBe(
      false,
    );
  });
});

describe('createDraftOrderRequestSchema: kupon (T7.2)', () => {
  const couponOf = (couponCode: string) =>
    createDraftOrderRequestSchema.parse({ ...draftRequest, couponCode }).couponCode;

  it('bos ya da yalnizca bosluk = kupon yok', () => {
    expect(couponOf('')).toBeUndefined();
    expect(couponOf('   ')).toBeUndefined();
  });

  it('bosluklari kirpar; buyuk/kucuk harfi pricing normallestirir', () => {
    expect(couponOf('  ilk10 ')).toBe('ilk10');
  });

  it('sinirsiz metin kapidan gecmez', () => {
    expect(accepts({ couponCode: 'A'.repeat(MAX_COUPON_CODE_LENGTH) })).toBe(true);
    expect(accepts({ couponCode: 'A'.repeat(MAX_COUPON_CODE_LENGTH + 1) })).toBe(false);
  });
});
