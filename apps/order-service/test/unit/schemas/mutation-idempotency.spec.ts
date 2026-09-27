/**
 * Idempotency anahtari (ADR-08) TUM mutasyonlarin ortak kuralidir ve kaynakta tek
 * alt semadan gelir; bu yuzden bir kez yazilir ve UC semanin hepsinde denenir.
 * Yeni bir mutasyon eklenince bu tabloya eklenir: anahtari unutan sema burada
 * kirmizi olur (tek tek yazilan testlerde unutulan sema testsiz kaliyordu).
 */

import { IDEMPOTENCY_KEY_MAX_LENGTH, IDEMPOTENCY_KEY_MIN_LENGTH } from '@getir/contracts';
import { describe, expect, it } from 'vitest';

import {
  cancelOrderRequestSchema,
  createDraftOrderRequestSchema,
  createOrderRequestSchema,
} from '../../../src/interfaces/grpc/schemas.js';
import { IDEMPOTENCY_KEY, draftRequest } from '../../support/order-fixtures.js';

const MUTATIONS = [
  { name: 'CreateDraftOrder', schema: createDraftOrderRequestSchema, request: draftRequest },
  {
    name: 'CreateOrder',
    schema: createOrderRequestSchema,
    request: { orderId: 'ord_1', userId: 'usr_1', idempotencyKey: IDEMPOTENCY_KEY },
  },
  {
    name: 'CancelOrder',
    schema: cancelOrderRequestSchema,
    request: { orderId: 'ord_1', userId: 'usr_1', reason: '', idempotencyKey: IDEMPOTENCY_KEY },
  },
];

describe.each(MUTATIONS)('$name: idempotency anahtari (ADR-08)', ({ schema, request }) => {
  const accepts = (idempotencyKey: string): boolean =>
    schema.safeParse({ ...request, idempotencyKey }).success;

  it('zorunludur: bos ya da yalnizca bosluk reddedilir', () => {
    expect(accepts('')).toBe(false);
    expect(accepts('   ')).toBe(false);
  });

  it('sozlesmenin uzunluk sinirlarini birebir uygular', () => {
    // Sinirlar REST basligi ve Redis anahtariyla ayni kaynaktan gelir: REST'in
    // kabul ettigini order reddetmemeli, reddettigini kabul etmemeli.
    expect(accepts('a'.repeat(IDEMPOTENCY_KEY_MIN_LENGTH - 1))).toBe(false);
    expect(accepts('a'.repeat(IDEMPOTENCY_KEY_MIN_LENGTH))).toBe(true);
    expect(accepts('a'.repeat(IDEMPOTENCY_KEY_MAX_LENGTH))).toBe(true);
    expect(accepts('a'.repeat(IDEMPOTENCY_KEY_MAX_LENGTH + 1))).toBe(false);
  });
});
