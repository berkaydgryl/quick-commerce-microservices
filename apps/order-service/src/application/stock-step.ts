/**
 * Saga'nin stok adimlari (T11.2): kilidi kesinlestirme ve birakma. Kilidin
 * alinmasi taslakta (draft-reservation.ts).
 */

import type { ReleaseReason } from '../domain/stock-reservation.js';
import type { Order } from '../domain/order.js';
import type { RequestScope } from './request-scope.js';
import type { Settlement, StockReservations } from './stock-reservations.js';

export interface StockStepDeps {
  readonly stock: StockReservations;
}

/**
 * Kilidi birakir; HATA FIRLATMAZ. Birakilamazsa (inventory kapali) kilit suresi
 * dolunca inventory'nin supurucusu stoku geri verir: en fazla rezervasyon
 * suresi kadar stok bekler, satilan stok degismez. Saga'nin asil hatasi
 * (risk reddi, kart reddi) bu yuzden gizlenmez.
 */
export async function releaseStock(
  deps: StockStepDeps,
  order: Order,
  reason: ReleaseReason,
  scope: RequestScope,
): Promise<void> {
  if (order.reservation === undefined) {
    return;
  }
  try {
    const outcome = await deps.stock.release(
      { orderId: order.id, marketId: order.marketId, reason },
      scope,
    );
    scope.logger.info({ orderId: order.id, reason, outcome }, 'stok kilidi birakildi');
  } catch (error: unknown) {
    scope.logger.warn(
      { err: error, orderId: order.id, reason },
      'stok kilidi birakilamadi; suresi dolunca inventory geri verir',
    );
  }
}

/** Kilidi kesinlestirir (stok kalici duser). Hata firlatabilir: cagiran karar verir. */
export function commitStock(
  deps: StockStepDeps,
  order: Order,
  scope: RequestScope,
): Promise<Settlement> {
  return deps.stock.commit({ orderId: order.id, marketId: order.marketId }, scope);
}
