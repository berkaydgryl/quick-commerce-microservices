/**
 * CreateDraftOrder birim testlerinin ortak duzenegi (#154, #203): bellek deposu,
 * sahte catalog ve sahte inventory; use-case bunlarla kurulur.
 */

import { AppError } from '@getir/core';
import type { Clock } from '@getir/core';

import type { CreateDraftOrder } from '../../src/application/create-draft-order.js';
import { createCreateDraftOrder } from '../../src/application/create-draft-order.js';
import { ORPHAN_LOCK_MIN_AGE_SECONDS } from '../../src/config/constants.js';
import type { OrderHistoryReader } from '../../src/domain/order-history-reader.js';
import { InMemoryOrderStore } from '../../src/infrastructure/memory/in-memory-order-store.js';
import { FakeCatalogPricing } from './fake-catalog-pricing.js';
import { FAKE_TTL_SECONDS, FakeStockReservations } from './fake-stock-reservations.js';

export interface DraftHarness {
  readonly repository: InMemoryOrderStore;
  readonly catalog: FakeCatalogPricing;
  readonly stock: FakeStockReservations;
  /** Use-case; gecmis okuyucusu verilmezse bellek deposu. */
  useCase(history?: Pick<OrderHistoryReader, 'hasPaidOrder'>): CreateDraftOrder;
}

export function draftHarness(clock: Clock): DraftHarness {
  const repository = new InMemoryOrderStore();
  const catalog = new FakeCatalogPricing();
  const stock = new FakeStockReservations(() => clock.now());
  return {
    repository,
    catalog,
    stock,
    useCase: (history = repository) =>
      createCreateDraftOrder({
        repository,
        history,
        catalog,
        stock,
        reservationTtlSeconds: FAKE_TTL_SECONDS,
        orphanLockMinAgeSeconds: ORPHAN_LOCK_MIN_AGE_SECONDS,
        onOrphanLockReleased: () => undefined,
        clock,
      }),
  };
}

/** Promise'in AppError reddi; basari ya da baska tur hata testi dusurur. */
export async function rejectionOf(promise: Promise<unknown>): Promise<AppError> {
  const error = await promise.then(
    () => undefined,
    (reason: unknown) => reason,
  );
  if (error instanceof AppError) return error;
  throw new Error('AppError beklenirdi');
}
