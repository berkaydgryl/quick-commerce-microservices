/**
 * Use-case: demo personalarinin siparis gecmisini yazar (pnpm seed:personas, T8.1).
 */

import { AppError } from '@getir/core';

import type { Order } from '../domain/order.js';
import type { PersonaOrderWriter } from '../domain/persona-order-writer.js';

export interface SeedPersonaOrdersDeps {
  readonly writer: PersonaOrderWriter;
  /** Gecmisi silinip yeniden yazilacak persona kullanicilari. */
  readonly userIds: readonly string[];
  readonly orders: readonly Order[];
  /** true ise seed REDDEDILIR. */
  readonly isProduction: boolean;
}

export interface SeedPersonaOrdersResult {
  readonly users: number;
  readonly orders: number;
}

export type SeedPersonaOrders = () => Promise<SeedPersonaOrdersResult>;

export function createSeedPersonaOrders(deps: SeedPersonaOrdersDeps): SeedPersonaOrders {
  return async () => {
    // Bilinen sifreli demo hesaplarinin gecmisi gercek veritabanina yazilmaz;
    // yanlis ortam degiskeniyle canliya kosulursa bu kapi durdurur.
    if (deps.isProduction) {
      throw AppError.forbidden(
        'Persona seed production ortaminda calistirilamaz (NODE_ENV=production)',
      );
    }
    await deps.writer.replaceForUsers(deps.userIds, deps.orders);
    return { users: deps.userIds.length, orders: deps.orders.length };
  };
}
