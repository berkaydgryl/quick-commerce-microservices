/**
 * BatchGetOffers use-case (T9.3): satilabilir teklif / missing ayrimi, market
 * varligi, tekrar eden kimlik ve "50 kalemlik sepet TEK cagriyla" olcutu.
 */

import { AppError, ERROR_CODES } from '@getir/core';
import { describe, expect, it, vi } from 'vitest';

import { createBatchGetOffers } from '../../src/application/batch-get-offers.js';
import type { Offer } from '../../src/domain/catalog.js';
import { createInMemoryReaders } from '../../src/infrastructure/memory/in-memory-catalog.js';

const MIGROS = 'mkt_migros-jet-moda';
const MANAV = 'mkt_kardesler-manavi';

function build() {
  const { offers, markets } = createInMemoryReaders();
  return createBatchGetOffers({ offers, markets });
}

async function rejection(promise: Promise<unknown>): Promise<AppError> {
  const error: unknown = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  if (!(error instanceof AppError)) throw new Error('AppError bekleniyordu');
  return error;
}

describe('BatchGetOffers', () => {
  it('aktif teklifler offers da, fiyat o marketin', async () => {
    const result = await build()({ marketId: MIGROS, productIds: ['prd_sut-1l', 'prd_kola-1l'] });

    expect(result.offers.map((offer) => [offer.product.id, offer.priceMinor])).toEqual([
      ['prd_sut-1l', 3490],
      ['prd_kola-1l', expect.any(Number)],
    ]);
    expect(result.missing).toEqual([]);
  });

  it('PASIF teklif satilamaz: missing e duser (Migros camasir suyu)', async () => {
    const result = await build()({
      marketId: MIGROS,
      productIds: ['prd_sut-1l', 'prd_camasir-suyu'],
    });

    expect(result.offers.map((offer) => offer.product.id)).toEqual(['prd_sut-1l']);
    expect(result.missing).toEqual(['prd_camasir-suyu']);
  });

  it('baska marketin urunu ve hic olmayan kimlik missing (T9.3: baska marketin urunu reddedilir)', async () => {
    const result = await build()({
      marketId: MANAV,
      productIds: ['prd_domates-1k', 'prd_sut-1l', 'prd_yok'],
    });

    expect(result.offers.map((offer) => offer.product.id)).toEqual(['prd_domates-1k']);
    expect(result.missing).toEqual(['prd_sut-1l', 'prd_yok']);
  });

  it('tekrar eden kimlik tek sayilir; cevap istek sirasini korur', async () => {
    const result = await build()({
      marketId: MIGROS,
      productIds: ['prd_kola-1l', 'prd_yok', 'prd_sut-1l', 'prd_kola-1l', 'prd_yok'],
    });

    expect(result.offers.map((offer) => offer.product.id)).toEqual(['prd_kola-1l', 'prd_sut-1l']);
    expect(result.missing).toEqual(['prd_yok']);
  });

  it('bilinmeyen market NOT_FOUND', async () => {
    const error = await rejection(build()({ marketId: 'mkt_yok', productIds: ['prd_sut-1l'] }));

    expect(error.code).toBe(ERROR_CODES.NOT_FOUND);
    expect(error.details).toEqual({ marketId: 'mkt_yok' });
  });

  it('bos liste bos cevap', async () => {
    expect(await build()({ marketId: MIGROS, productIds: [] })).toEqual({
      offers: [],
      missing: [],
    });
  });

  it('T9.3 olcutu: 50 kalemlik sepet TEK okuma cagrisiyla fiyatlanir (N+1 yok)', async () => {
    const findOffersByProductIds = vi.fn((): Promise<readonly Offer[]> => Promise.resolve([]));
    const batch = createBatchGetOffers({
      offers: { findOffersByProductIds },
      markets: { marketExists: () => Promise.resolve(true) },
    });
    const fifty = Array.from({ length: 50 }, (_, index) => `prd_urun-${index}`);

    const result = await batch({ marketId: MIGROS, productIds: fifty });

    expect(findOffersByProductIds).toHaveBeenCalledOnce();
    expect(findOffersByProductIds).toHaveBeenCalledWith(MIGROS, fifty);
    expect(result.missing).toHaveLength(50);
  });
});
