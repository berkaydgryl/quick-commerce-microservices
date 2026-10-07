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
 *     odeme asamasindaysa RESERVATION_ACTIVE ("devam eden odemen var");
 *     kilidin siparis KAYDI yoksa (yetim) yalnizca yeterince eskiyse birakilir
 *     (releaseOrphanLock; T15.3, bekleyen is 126);
 *   - Reserve'in cevabi belirsizse (zaman asimi, baglanti): kilit inventory'de
 *     alinmis olabilir; ayni siparis icin telafi Release (draft_not_saved),
 *     sonra asil hata. Yoksa kilit order'in bilmedigi siparis adina kalirdi.
 */

import { AppError, ERROR_CODES, ORDER_STATUS } from '@getir/core';
import type { Clock } from '@getir/core';

import { orderCreatedEvents, statusChangedEvents } from '../domain/order-events.js';
import type { OrderRepository } from '../domain/order-repository.js';
import type { Order } from '../domain/order.js';
import { TIMELINE_NOTE, transitionOrder } from '../domain/order.js';
import { MS_PER_SECOND } from '../config/constants.js';
import { holdsNoStock, RELEASE_REASON } from '../domain/stock-reservation.js';
import type { RequestScope } from './request-scope.js';
import { SETTLEMENT } from './stock-reservations.js';
import type { ReserveStockOutcome, StockReservations } from './stock-reservations.js';

type ActiveLock = Extract<ReserveStockOutcome, { kind: 'user-has-active' }>;

export interface DraftReservationDeps {
  readonly repository: Pick<OrderRepository, 'insert' | 'findById' | 'update'>;
  readonly stock: StockReservations;
  readonly clock: Clock;
  /** Kilidin omru (sn, RESERVATION_TTL_SECONDS); banda gore kisaltma T11.3'te. */
  readonly reservationTtlSeconds: number;
  /** Yetim kilidin birakilabilmesi icin en kucuk yas (sn; ORPHAN_LOCK_MIN_AGE_SECONDS). */
  readonly orphanLockMinAgeSeconds: number;
  /** Yetim kilit birakildi: sayac (interfaces/grpc/orphan-lock-metrics.ts). */
  readonly onOrphanLockReleased: () => void;
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
  const freed = await freePreviousLock(deps, draft, first, scope);
  if (!freed) {
    throw first.error;
  }
  const second = await reserve(deps, draft, scope);
  if (second.kind === 'user-has-active') {
    throw second.error;
  }
  return settle(deps, draft, second);
}

async function reserve(
  deps: DraftReservationDeps,
  draft: Order,
  scope: RequestScope,
): Promise<ReserveStockOutcome> {
  try {
    return await deps.stock.reserve(
      {
        orderId: draft.id,
        userId: draft.userId,
        marketId: draft.marketId,
        lines: draft.items.map((item) => ({ sku: item.sku, quantity: item.quantity })),
        ttlSeconds: deps.reservationTtlSeconds,
      },
      scope,
    );
  } catch (error: unknown) {
    await releaseUncertainLock(deps, draft, scope);
    throw error;
  }
}

/**
 * Reserve'in cevabi belirsiz (T15.3, bekleyen is 126): inventory kilidi almis,
 * cevap sure sinirindan sonra gelmis olabilir. Ayni siparis icin Release; kilit
 * yoksa NOT_FOUND, zararsiz. HATA FIRLATMAZ: istemci Reserve'in hatasini alir.
 * Release Reserve'den once uygulanirsa (gec yazim) kilit yine yetim kalir;
 * onu sonraki sepet birakir (releaseOrphanLock).
 */
async function releaseUncertainLock(
  deps: DraftReservationDeps,
  draft: Order,
  scope: RequestScope,
): Promise<void> {
  const reason = RELEASE_REASON.DRAFT_NOT_SAVED;
  try {
    const outcome = await deps.stock.release(
      { orderId: draft.id, marketId: draft.marketId, reason },
      scope,
    );
    if (outcome === SETTLEMENT.NOT_FOUND) {
      scope.logger.info(
        { orderId: draft.id, reason, outcome },
        'Reserve cevabi belirsiz; inventory de bu siparisin kilidi yok, telafi gerekmedi',
      );
      return;
    }
    scope.logger.warn(
      { orderId: draft.id, reason, outcome },
      'Reserve cevabi belirsiz; inventory kilidi almisti, telafi olarak birakildi',
    );
  } catch (releaseError: unknown) {
    scope.logger.warn(
      { err: releaseError, orderId: draft.id, reason },
      'Reserve cevabi belirsiz, telafi Release de yapilamadi; kilit suresi dolunca duser',
    );
  }
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
 * Kullanicinin kilit tutan onceki siparisine bakar. Siparisin kaydi yoksa kilit
 * yetimdir: kurallari releaseOrphanLock'ta. Kayit baska kullanicininsa ya da
 * siparis kilidi hakli olarak tutuyorsa (risk kontrolu, odeme) dokunulmaz.
 * @returns eski kilit birakildi mi?
 */
async function freePreviousLock(
  deps: DraftReservationDeps,
  draft: Order,
  active: ActiveLock,
  scope: RequestScope,
): Promise<boolean> {
  const previous = await deps.repository.findById(active.activeOrderId);
  if (previous === null) {
    return releaseOrphanLock(deps, draft, active, scope);
  }
  if (previous.userId !== draft.userId) {
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

/**
 * Kilidin siparis KAYDI yok (yetim; T15.3, bekleyen is 126): Reserve cevabi
 * kaybolmus ya da order taslagi yazamadan cokmus. Yalnizca yasi
 * orphanLockMinAgeSeconds'i astiysa birakilir: daha genc kilit es zamanli ikinci
 * istegin (baska sekme) henuz yazilmamis taslagina ait olabilir. Yas = kilit
 * omru - inventory'nin bildirdigi kalan omur; bilinmiyorsa birakilmaz.
 *
 * Kimlik inventory'nin KULLANICI kilidinden gelir (kilit bu kullanicinin),
 * istekten degil. Kilidin marketi bilinmez: yeni sepetin marketinde denenir;
 * baska marketteyse NOT_FOUND, birakilmaz (bekleyen is 132).
 */
async function releaseOrphanLock(
  deps: DraftReservationDeps,
  draft: Order,
  active: ActiveLock,
  scope: RequestScope,
): Promise<boolean> {
  const orphan = { orderId: draft.id, orphanOrderId: active.activeOrderId };
  const ageMs =
    active.activeExpiresInMs === undefined
      ? undefined
      : deps.reservationTtlSeconds * MS_PER_SECOND - active.activeExpiresInMs;
  if (ageMs === undefined || ageMs <= deps.orphanLockMinAgeSeconds * MS_PER_SECOND) {
    scope.logger.info(
      { ...orphan, ageMs },
      'kaydi olmayan kilit genc ya da yasi bilinmiyor; dokunulmadi',
    );
    return false;
  }
  const reason = RELEASE_REASON.STALE_LOCK;
  const outcome = await deps.stock.release(
    { orderId: active.activeOrderId, marketId: draft.marketId, reason },
    scope,
  );
  if (outcome === SETTLEMENT.NOT_FOUND) {
    scope.logger.info(
      { ...orphan, ageMs, marketId: draft.marketId },
      'yetim kilit bu markette yok (baska market ya da dusmus); birakilamadi',
    );
    return false;
  }
  if (outcome === SETTLEMENT.APPLIED) {
    deps.onOrphanLockReleased();
  }
  scope.logger.warn(
    { ...orphan, ageMs, reason, outcome },
    'kaydi olmayan (yetim) stok kilidi birakildi',
  );
  return true;
}
