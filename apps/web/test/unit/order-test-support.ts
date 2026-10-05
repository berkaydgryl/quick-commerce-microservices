/** Siparis testlerinin ortak ornekleri (T11.16): ozet ve tam siparis, sozlesmeye uyar. */

import type { Order, OrderSummary } from '@getir/contracts';

export const ORDER_ID = 'ord_0000000000000000000000000000000a';
export const MARKET_ID = 'mkt_moda-kasabi';

const TRY = (amountMinor: number) => ({ amountMinor, currency: 'TRY' as const });

export const SUMMARY: OrderSummary = {
  id: ORDER_ID,
  status: 'DELIVERED',
  marketId: MARKET_ID,
  marketName: 'Moda Kasabı',
  total: TRY(50_000),
  createdAt: '2026-10-05T12:00:00.000Z',
};

export const ORDER: Order = {
  id: ORDER_ID,
  status: 'DELIVERED',
  marketId: MARKET_ID,
  lines: [
    {
      productId: 'prd_kiyma-500g',
      name: 'Dana Kıyma 500 g',
      quantity: 2,
      unitPrice: TRY(20_000),
      lineTotal: TRY(40_000),
    },
    {
      productId: 'prd_sut-1l',
      name: 'Süt 1 L',
      quantity: 1,
      unitPrice: TRY(5_000),
      lineTotal: TRY(5_000),
    },
  ],
  subtotal: TRY(45_000),
  deliveryFee: TRY(5_000),
  discount: TRY(0),
  total: TRY(50_000),
  address: {
    line: 'Caferağa Mah. Moda Cad. No:12, Kadıköy',
    location: { lat: 40.9885, lng: 29.0262 },
  },
  timeline: [
    { status: 'DRAFT', at: '2026-10-05T11:58:00.000Z' },
    { status: 'PAID', at: '2026-10-05T12:00:00.000Z' },
    { status: 'DELIVERED', at: '2026-10-05T12:30:00.000Z' },
  ],
  createdAt: '2026-10-05T12:00:00.000Z',
};
