/**
 * Stok defterinin kurallari (T10.2, ADR-18): birakma kaydi onHand'i
 * degistirmez, ayni hareket ayni kimlige duser (B14). Mongo karsiligi
 * test/integration/stock-stores.spec.ts'te.
 */

import { describe, expect, it } from 'vitest';

import {
  commitEntries,
  expireEntries,
  extendEntries,
  LEDGER_KINDS,
  ledgerEntryId,
  releaseEntries,
  settlementOfKind,
} from '../../src/domain/stock-ledger.js';
import { InMemoryStockCommitter } from '../../src/infrastructure/memory/in-memory-stock-committer.js';
import { InMemoryStockLedger } from '../../src/infrastructure/memory/in-memory-stock-ledger.js';

const MARKET = 'mkt_migros-jet-moda';
const ORDER = 'ord_00000000000000000000000000000001';
const AT = new Date(Date.UTC(2026, 9, 1, 9, 0, 0));

const released = releaseEntries({
  marketId: MARKET,
  orderId: ORDER,
  reason: 'user_cancelled',
  lines: [
    { sku: 'SUT-1L', quantity: 2 },
    { sku: 'KOLA-1L', quantity: 1 },
  ],
  at: AT,
});

describe('birakma kaydi', () => {
  it('kalem basina bir kayit: onHand degismez (delta 0), adet ve gerekce oldugu gibi', () => {
    expect(released).toEqual([
      {
        marketId: MARKET,
        sku: 'SUT-1L',
        kind: 'release',
        delta: 0,
        quantity: 2,
        reason: 'user_cancelled',
        orderId: ORDER,
        at: AT,
      },
      {
        marketId: MARKET,
        sku: 'KOLA-1L',
        kind: 'release',
        delta: 0,
        quantity: 1,
        reason: 'user_cancelled',
        orderId: ORDER,
        at: AT,
      },
    ]);
  });

  it('tur -> siparisin sonucu: birakma "released", onay "committed", acilis sonuc degil', () => {
    expect(settlementOfKind(LEDGER_KINDS.RELEASE)).toBe('released');
    expect(settlementOfKind(LEDGER_KINDS.COMMIT)).toBe('committed');
    expect(settlementOfKind(LEDGER_KINDS.EXPIRE)).toBe('expired');
    expect(settlementOfKind(LEDGER_KINDS.OPENING)).toBeUndefined();
    expect(settlementOfKind(LEDGER_KINDS.EXTEND)).toBeUndefined();
  });
});

describe('uzatma kaydi (T11.3, B21)', () => {
  it('kalem basina bir kayit: eldeki adet degismez (delta 0), gerekce payment_attempt, sira numarasiyla', () => {
    expect(
      extendEntries({
        marketId: MARKET,
        orderId: ORDER,
        lines: [{ sku: 'SUT-1L', quantity: 2 }],
        sequence: 2,
        at: AT,
      }),
    ).toEqual([
      {
        marketId: MARKET,
        sku: 'SUT-1L',
        kind: 'extend',
        delta: 0,
        quantity: 2,
        reason: 'payment_attempt',
        orderId: ORDER,
        sequence: 2,
        at: AT,
      },
    ]);
  });

  it('sira kimlikte: ikinci uzatma birincinin uzerine dusmez; ayni uzatmanin tekrari duser (B14)', async () => {
    const ledger = new InMemoryStockLedger();
    const nth = (sequence: number) =>
      extendEntries({
        marketId: MARKET,
        orderId: ORDER,
        lines: [{ sku: 'SUT-1L', quantity: 2 }],
        sequence,
        at: AT,
      });

    await ledger.record(nth(1));
    await ledger.record(nth(2));
    await ledger.record(nth(2));

    expect(ledger.all().map((entry) => ledgerEntryId(entry))).toEqual([
      `${ORDER}/SUT-1L/extend-1`,
      `${ORDER}/SUT-1L/extend-2`,
    ]);
    expect(await ledger.settlementOf(MARKET, ORDER)).toBeUndefined();
  });
});

describe('sure dolumu kaydi (T10.3)', () => {
  it('kalem basina bir kayit: eldeki adet degismez (delta 0), gerekce expired', () => {
    expect(
      expireEntries({
        marketId: MARKET,
        orderId: ORDER,
        lines: [{ sku: 'SUT-1L', quantity: 2 }],
        at: AT,
      }),
    ).toEqual([
      {
        marketId: MARKET,
        sku: 'SUT-1L',
        kind: 'expire',
        delta: 0,
        quantity: 2,
        reason: 'expired',
        orderId: ORDER,
        at: AT,
      },
    ]);
  });
});

describe('onay kaydi (T10.2 PR 2)', () => {
  it('kalem basina bir kayit: eldeki adet duser (delta -adet), gerekce order_paid', () => {
    expect(
      commitEntries({
        marketId: MARKET,
        orderId: ORDER,
        lines: [{ sku: 'SUT-1L', quantity: 2 }],
        at: AT,
      }),
    ).toEqual([
      {
        marketId: MARKET,
        sku: 'SUT-1L',
        kind: 'commit',
        delta: -2,
        quantity: 2,
        reason: 'order_paid',
        orderId: ORDER,
        at: AT,
      },
    ]);
  });
});

describe('bellekteki onay yazimi (MOCK, B16)', () => {
  const committed = commitEntries({
    marketId: MARKET,
    orderId: ORDER,
    lines: [
      { sku: 'SUT-1L', quantity: 2 },
      { sku: 'KOLA-1L', quantity: 4 },
    ],
    at: AT,
  });
  const levels = [
    { marketId: MARKET, sku: 'SUT-1L', onHand: 24 },
    { marketId: MARKET, sku: 'KOLA-1L', onHand: 3 },
  ];

  it('eldeki adet duser, defter yazilir; ikinci kez ayni onay adedi TEKRAR dusurmez', async () => {
    const ledger = new InMemoryStockLedger();
    const committer = new InMemoryStockCommitter(levels, ledger);

    expect((await committer.commit(committed)).written).toBe(2);
    expect(await committer.commit(committed)).toEqual({ written: 0, negative: [] });

    expect(committer.onHandOf(MARKET, 'SUT-1L')).toBe(22);
    expect(await ledger.settlementOf(MARKET, ORDER)).toBe('committed');
  });

  it('eksiye dusen kalem bildirilir; onay yine yazilir', async () => {
    const committer = new InMemoryStockCommitter(levels, new InMemoryStockLedger());

    expect(await committer.commit(committed)).toEqual({
      written: 2,
      negative: [{ sku: 'KOLA-1L', onHand: -1 }],
    });
  });
});

describe('kayit kimligi (B14)', () => {
  it('siparis hareketi siparis/sku/tur; acilis tur/market/sku', () => {
    expect(
      ledgerEntryId({ marketId: MARKET, sku: 'SUT-1L', kind: 'release', orderId: ORDER }),
    ).toBe(`${ORDER}/SUT-1L/release`);
    expect(ledgerEntryId({ marketId: MARKET, sku: 'SUT-1L', kind: 'opening' })).toBe(
      `opening/${MARKET}/SUT-1L`,
    );
  });
});

describe('bellekteki defter (MOCK, B16)', () => {
  it('ayni kayit ikinci kez yazilmaz; ilk kayit (gerekcesiyle) kalir', async () => {
    const ledger = new InMemoryStockLedger();

    await ledger.record(released);
    await ledger.record(released.map((entry) => ({ ...entry, reason: 'payment_failed' })));

    expect(ledger.all()).toEqual(released);
  });

  it('siparisin sonucu: birakildiysa "released"; kaydi yoksa ya da baska marketteyse undefined', async () => {
    const ledger = new InMemoryStockLedger();
    await ledger.record(released);

    expect(await ledger.settlementOf(MARKET, ORDER)).toBe('released');
    expect(await ledger.settlementOf('mkt_a101-caferaga', ORDER)).toBeUndefined();
    expect(
      await ledger.settlementOf(MARKET, 'ord_00000000000000000000000000000002'),
    ).toBeUndefined();
  });
});
