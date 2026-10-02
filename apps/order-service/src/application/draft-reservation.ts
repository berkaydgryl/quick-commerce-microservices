/**
 * Taslagin stok kilidi (T11.2, saga 1. gecis "Reserve"): taslak YAZILMADAN once
 * kilit alinir; kilitli taslak tek yazimda kaydedilir.
 *
 * Sonuclar:
 *   - kilitlendi: taslak rezervasyonuyla doner (cagiran yazar);
 *   - stok yetmedi: taslak CANCELLED olarak yazilir (iz kalir, roadmap telafi
 *     tablosu), inventory'nin hatasi (sku, requested, available) aynen firlatilir;
 *   - kullanicinin baska kilidi var (B22): o siparis hala TASLAK ise iptal edilip
 *     kilidi birakilir ve bir kez daha denenir (sepet yenilendi); saga onu
 *     zaten durdurmus ama kilidi birakilamamis kaldiysa kilit simdi birakilir;
 *     odeme asamasindaysa RESERVATION_ACTIVE ("devam eden odemen var").
 */

import { AppError, ERROR_CODES, ORDER_STATUS } from '@getir/core';
import type { Clock } from '@getir/core';

import { orderCreatedEvents, statusChangedEvents } from '../domain/order-events.js';
import type { OrderRepository } from '../domain/order-repository.js';
import type { Order } from '../domain/order.js';
import { TIMELINE_NOTE, transitionOrder } from '../domain/order.js';
import { holdsNoStock, RELEASE_REASON } from '../domain/stock-reservation.js';
import type { RequestScope } from './request-scope.js';
import type { ReserveStockOutcome, StockReservations } from './stock-reservations.js';

export interface DraftReservationDeps {
  readonly repository: Pick<OrderRepository, 'insert' | 'findById' | 'update'>;
  readonly stock: StockReservations;
  readonly clock: Clock;
  /** Kilidin omru (sn, RESERVATION_TTL_SECONDS); banda gore kisaltma T11.3'te. */
  readonly reservationTtlSeconds: number;
}

/** Taslagi kilitler; kilitli taslagi dondurur. Kilitlenemezse hata firlatir. */
export async function reserveDraftStock(
  deps: DraftReservationDeps,
  draft: Order,
  scope: RequestScope,
): Promise<Order> {
  const first = await reserve(deps, draft, scope);
  if (first.kind !== 'user-has-active') {
    return settle(deps, draft, first);
  }
  const freed = await freePreviousLock(deps, draft, first.activeOrderId, scope);
  if (!freed) {
    throw first.error;
  }
  const second = await reserve(deps, draft, scope);
  if (second.kind === 'user-has-active') {
    throw second.error;
  }
  return settle(deps, draft, second);
}

function reserve(
  deps: DraftReservationDeps,
  draft: Order,
  scope: RequestScope,
): Promise<ReserveStockOutcome> {
  return deps.stock.reserve(
    {
      orderId: draft.id,
      userId: draft.userId,
      marketId: draft.marketId,
      lines: draft.items.map((item) => ({ sku: item.sku, quantity: item.quantity })),
      ttlSeconds: deps.reservationTtlSeconds,
    },
    scope,
  );
}

async function settle(
  deps: DraftReservationDeps,
  draft: Order,
  outcome: Exclude<ReserveStockOutcome, { kind: 'user-has-active' }>,
): Promise<Order> {
  if (outcome.kind === 'reserved') {
    return {
      ...draft,
      reservation: { reservedAt: deps.clock.date(), expiresAt: outcome.expiresAt },
    };
  }
  // Stok yetmedi: taslak iz olarak CANCELLED yazilir, kullaniciya inventory'nin
  // ayrintisi (hangi urun, kac tane kaldi) gider.
  const cancelled = transitionOrder(
    draft,
    ORDER_STATUS.CANCELLED,
    deps.clock,
    ERROR_CODES.STOCK_INSUFFICIENT,
  );
  await deps.repository.insert(cancelled, [
    ...orderCreatedEvents(draft),
    ...statusChangedEvents(draft, cancelled),
  ]);
  throw outcome.error;
}

/**
 * Kullanicinin kilit tutan onceki siparisine bakar. Kilit bu siparise ait degilse
 * (kayit yok, baska kullanici) ya da siparis kilidi hakli olarak tutuyorsa
 * (risk kontrolu, odeme) dokunulmaz.
 * @returns eski kilit birakildi mi?
 */
async function freePreviousLock(
  deps: DraftReservationDeps,
  draft: Order,
  activeOrderId: string,
  scope: RequestScope,
): Promise<boolean> {
  const previous = await deps.repository.findById(activeOrderId);
  if (previous === null || previous.userId !== draft.userId) {
    return false;
  }
  if (previous.status === ORDER_STATUS.DRAFT) {
    return replacePreviousDraft(deps, draft, previous, scope);
  }
  if (!holdsNoStock(previous)) {
    return false;
  }
  const reason = RELEASE_REASON.STALE_LOCK;
  const outcome = await deps.stock.release(
    { orderId: previous.id, marketId: previous.marketId, reason },
    scope,
  );
  scope.logger.warn(
    { orderId: draft.id, staleOrderId: previous.id, status: previous.status, reason, outcome },
    'onceki siparisin birakilamamis kilidi birakildi',
  );
  return true;
}

/**
 * Onceki TASLAGI iptal eder ve kilidini birakir; yeni sepet onun yerini alir.
 * Iptal kilitten ONCE yazilir: es zamanli bir "siparisi ver" o taslagi
 * ilerlettiyse (surum cakismasi) eski kilit korunur.
 */
async function replacePreviousDraft(
  deps: DraftReservationDeps,
  draft: Order,
  previous: Order,
  scope: RequestScope,
): Promise<boolean> {
  const cancelled = transitionOrder(
    previous,
    ORDER_STATUS.CANCELLED,
    deps.clock,
    TIMELINE_NOTE.CART_REPLACED,
  );
  try {
    await deps.repository.update(
      cancelled,
      previous.version,
      statusChangedEvents(previous, cancelled),
    );
  } catch (error: unknown) {
    if (error instanceof AppError && error.code === ERROR_CODES.CONFLICT) {
      return false;
    }
    throw error;
  }
  const reason = RELEASE_REASON.CART_REPLACED;
  const outcome = await deps.stock.release(
    { orderId: previous.id, marketId: previous.marketId, reason },
    scope,
  );
  scope.logger.info(
    { orderId: draft.id, replacedOrderId: previous.id, reason, outcome },
    'eski taslagin kilidi birakildi; yeni sepet kilitleniyor',
  );
  return true;
}
