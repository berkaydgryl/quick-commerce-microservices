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
 *     kapatmasin. Kalan sure yetiyorsa inventory'ye gidilmez. Uzatma siparisin
 *     bildigi bitisle gider (T15.3; bekleyen is 117): kilidin bitisi farkliysa
 *     (cevabi kaybolan uzatma ya da kaydedilmemis kisaltma) inventory hak
 *     harcamaz, guncel bitisi doner; o yazilir ve kalan sure hala yetmiyorsa
 *     yeni beklenenle bir tur daha uzatilir.
 *
 * Kilit dusmusse kilitsiz stokla para CEKILMEZ; siparis lapsed-order.ts'in
 * tablosuyla kapatilir (cancelLapsedOrder). inventory'ye ulasilamazsa hata yukari
 * gider, hicbir sey yazilmaz; uzatmanin ikinci turunda ise ilk turda yazilan
 * guncel bitis kalir.
 */

import { AppError, ERROR_CODES, ORDER_STATUS } from '@getir/core';
import type { RiskBand } from '@getir/core';

import { MS_PER_SECOND } from '../config/constants.js';
import type { OrderRepository } from '../domain/order-repository.js';
import type { Order } from '../domain/order.js';
import { paymentInProgress } from '../domain/payment-standing.js';
import {
  needsLockExtension,
  rescheduleReservation,
  shortensLock,
  withReservationExpiry,
} from '../domain/stock-reservation.js';
import { closeLapsedOrder } from './lapsed-order.js';
import type { LapseDeps } from './lapsed-order.js';
import type { RequestScope } from './request-scope.js';

/** Banda gore kilit ve odeme oncesi uzatma ayarlari (ortamdan, sn). */
export interface LockPolicy {
  /** Orta bantta kalan sure siniri (RESERVATION_TTL_MEDIUM_RISK_SECONDS). */
  readonly mediumRiskSeconds: number;
  /** Odeme oncesi pencere ve uzatma miktari (RESERVATION_EXTEND_SECONDS). */
  readonly extendSeconds: number;
}

/** Kilit suresi ayarlari ve kilidi dusmus siparisin kapatilmasi icin gerekenler. */
export interface LockTimingDeps extends LapseDeps {
  /** findById: kapatma cakisirsa siparisin son hali (cancelLapsedOrder). */
  readonly repository: Pick<OrderRepository, 'update' | 'findById'>;
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
 * Kilit `moved` donerse guncel bitis yazilir ve en cok bir tur daha denenir.
 */
export async function securePaymentWindow(
  deps: LockTimingDeps,
  order: Order,
  scope: RequestScope,
): Promise<Order> {
  const { extendSeconds } = deps.lockPolicy;
  const windowMs = extendSeconds * MS_PER_SECOND;
  let current = order;
  for (let round = 1; round <= EXTEND_ROUNDS; round += 1) {
    const expected = current.reservation?.expiresAt;
    if (expected === undefined || !needsLockExtension(current, deps.clock.date(), windowMs)) {
      return current;
    }
    const timing = await deps.stock.extend(
      {
        orderId: current.id,
        marketId: current.marketId,
        additionalSeconds: extendSeconds,
        expectedExpiresAt: expected,
      },
      scope,
    );
    if (timing.kind === 'lapsed') {
      return cancelLapsedOrder(deps, current, scope);
    }
    if (timing.kind === 'moved') {
      current = await recordExpiry(deps, current, timing.expiresAt);
      scope.logger.info(
        { orderId: current.id, expectedExpiresAt: expected, expiresAt: timing.expiresAt },
        'stok kilidinin bitisi siparistekinden farkliydi; guncel bitis yazildi',
      );
      continue;
    }
    if (!timing.changed) {
      scope.logger.warn(
        { orderId: current.id, expiresAt: timing.expiresAt },
        'stok kilidi uzatilamadi: uzatma hakki bitti; odeme kalan sureyle',
      );
      return current;
    }
    if (timing.expiresAt.getTime() !== expected.getTime() + windowMs) {
      // Sozlesmenin cagiran denetimi: beklenen bitisi uygulayan inventory tam
      // pencere kadar ileri alir. Tutmuyorsa sunucu denetimi uygulamamistir.
      scope.logger.error(
        { orderId: current.id, expectedExpiresAt: expected, expiresAt: timing.expiresAt },
        'stok servisi beklenen bitis denetimini uygulamamis olabilir (eski surum?)',
      );
    }
    const next = await recordExpiry(deps, current, timing.expiresAt);
    scope.logger.info(
      { orderId: current.id, expiresAt: timing.expiresAt },
      'odeme oncesi stok kilidi uzatildi',
    );
    return next;
  }
  scope.logger.warn(
    { orderId: current.id, expiresAt: current.reservation?.expiresAt },
    'stok kilidinin bitisi iki turda da kaydi; odeme guncel bitisle',
  );
  return current;
}

/** Odeme oncesi uzatmanin en cok tur sayisi: bir `moved` ve ardindan bir uzatma. */
const EXTEND_ROUNDS = 2;

/** Kilidin yeni bitisini siparise yazar (surum artar). */
async function recordExpiry(deps: LockTimingDeps, order: Order, expiresAt: Date): Promise<Order> {
  const next = rescheduleReservation(order, expiresAt, deps.clock.date());
  await deps.repository.update(next, order.version, []);
  return next;
}

/**
 * Kilidi dusmus siparis (T11.2 karari "iptal + 410"): kilitsiz stokla odeme
 * alinmaz. Kapatma karari lapsed-order.ts'te (supurucuyle ayni tablo; T15.3,
 * bekleyen is 122): odeme alinmissa iptal ve IADE, kart cekimi suruyorsa hicbir
 * sey yazilmaz (REQUEST_IN_PROGRESS), aksi halde iptal. Istemci iptalde
 * RESERVATION_EXPIRED alir ve sepeti yeniden onaylar. Kapatma cakisirsa siparisin
 * son haline bakilir: baska yol (supurucu, es zamanli istek) iptal ettiyse yine
 * 410, siparis ilerlediyse 409.
 */
export async function cancelLapsedOrder(
  deps: LockTimingDeps,
  order: Order,
  scope: RequestScope,
): Promise<never> {
  const outcome = await closeLapsedOrder(deps, order, scope);
  switch (outcome.kind) {
    case 'in-flight':
      throw paymentInProgress(order.id, outcome.paymentStatus);
    case 'conflict':
      if ((await deps.repository.findById(order.id))?.status !== ORDER_STATUS.CANCELLED) {
        throw AppError.conflict(undefined, { details: { orderId: order.id } });
      }
      throw reservationExpired(order.id, {});
    case 'closed':
      throw reservationExpired(order.id, { refunded: false });
    case 'refunded':
      throw reservationExpired(order.id, { refunded: true });
  }
}

/**
 * 410: siparis CANCELLED. `refunded` yalniz bu istek kapattiysa: true = iade
 * komutu siparisle birlikte yazildi (para payment-svc'de geri verilir).
 */
function reservationExpired(orderId: string, extra: { readonly refunded?: boolean }): AppError {
  return new AppError(ERROR_CODES.RESERVATION_EXPIRED, 'Rezervasyon suresi doldu', {
    details: { orderId, status: ORDER_STATUS.CANCELLED, ...extra },
  });
}
