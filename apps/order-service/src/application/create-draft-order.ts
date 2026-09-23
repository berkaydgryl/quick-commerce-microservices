/**
 * Use-case: sepeti taslak siparise cevirir.
 *
 * KAPSAM (T3.2): bugun yalnizca kimlik uretilir ve kayit acilir.
 * Sozlesmedeki tam akis - risk degerlendirmesi (T6.x), stok rezervasyonu
 * (T11.2) ve rezervasyon suresi - saga adimlari geldiginde buraya eklenecek.
 * Bugun eklemek, cagrilacak servisi olmayan bir zincir yazmak olurdu.
 */

import type { Clock } from '@getir/core';

import type { OrderRepository } from '../domain/order-repository.js';
import type { DraftOrderInput, Order } from '../domain/order.js';
import { createDraftOrder as buildDraftOrder } from '../domain/order.js';

export interface CreateDraftOrderDeps {
  readonly repository: OrderRepository;
  readonly clock: Clock;
}

export type CreateDraftOrder = (input: DraftOrderInput) => Promise<Order>;

export function createCreateDraftOrder(deps: CreateDraftOrderDeps): CreateDraftOrder {
  return async (input) => {
    const order = buildDraftOrder(input, deps.clock);
    await deps.repository.insert(order);
    return order;
  };
}
