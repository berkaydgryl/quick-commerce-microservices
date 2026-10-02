/**
 * Kilidin suresi saga'da (T11.3; roadmap "Bantlar ve aksiyonlar", B21, #72).
 * Kilit taslak acilirken alinir (T11.2, RESERVATION_TTL_SECONDS); burada iki ayar:
 *
 *   - Risk adimi: bant kilidi kisaltiyorsa (orta risk) kalan sure en cok
 *     RESERVATION_TTL_MEDIUM_RISK_SECONDS (2 dk). Yeni bitis risk karariyla AYNI
 *     yazimda kaydedilir.
 *   - Odeme ve 3DS denemesinden ONCE: kalan sure RESERVATION_EXTEND_SECONDS'tan
 *     (60 sn) azsa kilit o kadar uzatilir (inventory'de en cok 3 kez) ve yeni
 *     bitis HEMEN kaydedilir: 3DS beklerken supurucu eski bitise gore siparisi
 *     kapatmasin. Kalan sure yetiyorsa inventory'ye gidilmez.
 *
 * Kilit dusmusse siparis CANCELLED + RESERVATION_EXPIRED (410): kilitsiz stokla
 * para CEKILMEZ. inventory'ye ulasilamazsa hata yukari gider, hicbir sey yazilmaz.
 */

import { AppError, ERROR_CODES, ORDER_STATUS } from '@getir/core';
import type { Clock, RiskBand } from '@getir/core';

import { MS_PER_SECOND } from '../config/constants.js';
import { statusChangedEvents } from '../domain/order-events.js';
import type { OrderRepository } from '../domain/order-repository.js';
import type { Order } from '../domain/order.js';
import { transitionOrder } from '../domain/order.js';
import {
  needsLockExtension,
  RELEASE_REASON,
  rescheduleReservation,
  shortensLock,
  withReservationExpiry,
} from '../domain/stock-reservation.js';
import type { RequestScope } from './request-scope.js';
import { releaseStock } from './stock-step.js';
import type { StockStepDeps } from './stock-step.js';

/** Banda gore kilit ve odeme oncesi uzatma ayarlari (ortamdan, sn). */
export interface LockPolicy {
  /** Orta bantta kalan sure siniri (RESERVATION_TTL_MEDIUM_RISK_SECONDS). */
  readonly mediumRiskSeconds: number;
  /** Odeme oncesi pencere ve uzatma miktari (RESERVATION_EXTEND_SECONDS). */
  readonly extendSeconds: number;
}

/** Kilidi dusmus siparisin kapatilmasi icin gerekenler. */
export interface LapseDeps extends StockStepDeps {
  readonly repository: Pick<OrderRepository, 'update'>;
  readonly clock: Clock;
}

export interface LockTimingDeps extends LapseDeps {
  readonly lockPolicy: LockPolicy;
}

/**
 * Risk adimi: bant kilidi kisaltiyorsa inventory'de kisaltir ve yeni bitisi
 * siparise isler. YAZMAZ: cagiran risk karariyla ayni yazimda kaydeder.
 */
export async function lockForBand(
  deps: LockTimingDeps,
  order: Order,
  band: RiskBand,
  scope: RequestScope,
): Promise<Order> {
  if (!shortensLock(band) || order.reservation === undefined) {
    return order;
  }
  const timing = await deps.stock.shorten(
    {
      orderId: order.id,
      marketId: order.marketId,
      maxRemainingSeconds: deps.lockPolicy.mediumRiskSeconds,
    },
    scope,
  );
  if (timing.kind === 'lapsed') {
    return cancelLapsedOrder(deps, order, scope);
  }
  if (timing.changed) {
    scope.logger.info(
      { orderId: order.id, band, expiresAt: timing.expiresAt },
      'risk bandi stok kilidini kisaltti',
    );
  }
  return withReservationExpiry(order, timing.expiresAt);
}

/**
 * Odeme ya da 3DS denemesinden once: kalan sure pencereden azsa kilidi uzatir
 * ve yeni bitisi YAZAR (surum artar). Uzatma hakki bitmisse kalan sureyle
 * devam edilir: kesinlestirmede kilit dusmusse para iade edilir (payment-step).
 */
export async function securePaymentWindow(
  deps: LockTimingDeps,
  order: Order,
  scope: RequestScope,
): Promise<Order> {
  const { extendSeconds } = deps.lockPolicy;
  if (!needsLockExtension(order, deps.clock.date(), extendSeconds * MS_PER_SECOND)) {
    return order;
  }
  const timing = await deps.stock.extend(
    { orderId: order.id, marketId: order.marketId, additionalSeconds: extendSeconds },
    scope,
  );
  if (timing.kind === 'lapsed') {
    return cancelLapsedOrder(deps, order, scope);
  }
  if (!timing.changed) {
    scope.logger.warn(
      { orderId: order.id, expiresAt: timing.expiresAt },
      'stok kilidi uzatilamadi: uzatma hakki bitti; odeme kalan sureyle',
    );
    return order;
  }
  const next = rescheduleReservation(order, timing.expiresAt, deps.clock.date());
  await deps.repository.update(next, order.version, []);
  scope.logger.info(
    { orderId: order.id, expiresAt: timing.expiresAt },
    'odeme oncesi stok kilidi uzatildi',
  );
  return next;
}

/**
 * Kilidi dusmus siparis (T11.2 karari "iptal + 410"): CANCELLED, not
 * RESERVATION_EXPIRED; kilit birakilir (supurucu birakmadiysa, en iyi gayret),
 * istemci RESERVATION_EXPIRED alir ve sepeti yeniden onaylar. Kilitsiz stokla
 * odeme alinmaz.
 */
export async function cancelLapsedOrder(
  deps: LapseDeps,
  order: Order,
  scope: RequestScope,
): Promise<never> {
  const cancelled = transitionOrder(
    order,
    ORDER_STATUS.CANCELLED,
    deps.clock,
    ERROR_CODES.RESERVATION_EXPIRED,
  );
  await deps.repository.update(cancelled, order.version, statusChangedEvents(order, cancelled));
  await releaseStock(deps, order, RELEASE_REASON.RESERVATION_EXPIRED, scope);
  throw new AppError(ERROR_CODES.RESERVATION_EXPIRED, 'Rezervasyon suresi doldu', {
    details: { orderId: order.id, status: ORDER_STATUS.CANCELLED },
  });
}
