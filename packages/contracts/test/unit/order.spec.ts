/**
 * Gecmis Siparislerim (T11.16): ozet satiri ve sayfali liste. Market adi ve
 * iade bayragi istege bagli; iade yalnizca `true` olarak tasinir (yoksa alan
 * yok), sayfa ORDER_HISTORY_PAGE_SIZE_MAX'i asmaz.
 */

import { describe, expect, it } from 'vitest';

import {
  ORDER_HISTORY_PAGE_SIZE_DEFAULT,
  ORDER_HISTORY_PAGE_SIZE_MAX,
  orderSummaryListSchema,
  orderSummarySchema,
} from '../../src/index.js';

const SUMMARY = {
  id: 'ord_0000000000000000000000000000000a',
  status: 'DELIVERED',
  marketId: 'mkt_moda-kasabi',
  marketName: 'Moda Kasabı',
  total: { amountMinor: 50_000, currency: 'TRY' },
  createdAt: '2026-10-05T12:00:00.000Z',
};
const PAGE = { nextPageToken: '', totalSize: 0 };

describe('orderSummarySchema (T11.16)', () => {
  it('ozet: kimlik, durum, market, tutar, tarih', () => {
    expect(orderSummarySchema.parse(SUMMARY)).toEqual(SUMMARY);
  });

  it('market adi yoksa gecer; bos ad gecmez', () => {
    const { marketName: _omit, ...withoutName } = SUMMARY;
    expect(orderSummarySchema.safeParse(withoutName).success).toBe(true);
    expect(orderSummarySchema.safeParse({ ...SUMMARY, marketName: '' }).success).toBe(false);
  });

  it('iade yalnizca true; false gonderilmez (alan yok)', () => {
    expect(
      orderSummarySchema.safeParse({ ...SUMMARY, status: 'CANCELLED', refunded: true }).success,
    ).toBe(true);
    expect(orderSummarySchema.safeParse({ ...SUMMARY, refunded: false }).success).toBe(false);
  });

  it('bilinmeyen durum ve bicimsiz kimlik gecmez', () => {
    expect(orderSummarySchema.safeParse({ ...SUMMARY, status: 'LOST' }).success).toBe(false);
    expect(orderSummarySchema.safeParse({ ...SUMMARY, id: 'ord_1' }).success).toBe(false);
  });
});

describe('orderSummaryListSchema (T11.16)', () => {
  it('sayfa en fazla ORDER_HISTORY_PAGE_SIZE_MAX satir; varsayilan ondan kucuk', () => {
    const items = (count: number) => Array.from({ length: count }, () => SUMMARY);

    expect(ORDER_HISTORY_PAGE_SIZE_DEFAULT).toBeLessThanOrEqual(ORDER_HISTORY_PAGE_SIZE_MAX);
    expect(
      orderSummaryListSchema.safeParse({ items: items(ORDER_HISTORY_PAGE_SIZE_MAX), page: PAGE })
        .success,
    ).toBe(true);
    expect(
      orderSummaryListSchema.safeParse({
        items: items(ORDER_HISTORY_PAGE_SIZE_MAX + 1),
        page: PAGE,
      }).success,
    ).toBe(false);
  });
});
