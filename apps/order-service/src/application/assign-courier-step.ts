/**
 * Saga'nin kurye adimi (T13.1 PR 2): odenen siparise kurye ister ve sonucu
 * siparise yazar. Isci her siparis icin bunu cagirir (dispatch-couriers.ts).
 *
 *  - Kurye atandi       -> PAID kuryeyle PREPARING'e gecer (tek yazim, tek olay);
 *                          kuryesiz PREPARING'e yalnizca kurye yazilir (olay yok).
 *  - Uygun kurye yok    -> PREPARING kuryesiz, 30 sn sonra yeniden denenir.
 *  - courier-svc hatasi -> siparis DEGISMEZ, hata yukari: isci sonraki turda tekrar.
 *
 * ONCE ATAMA, SONRA YAZIM: courier-svc tekrar guvenlidir (ayni siparise ayni
 * kurye); order yazamadigi ya da cevabini alamadigi atamayi sonraki turda
 * yeniden ister, ikinci kurye baglanmaz.
 *
 * TELAFI (QA T3): atama ucustayken siparis kapanabilir (iptal). Iptal yolunun
 * ReleaseCourier'i atamadan ONCE varirsa bos doner (released=false), sonra atama
 * kuryeyi iptal edilmis siparise baglar. Bu yuzden yazim surum cakismasi alinca
 * siparis yeniden okunur:
 *   - son durumda ya da kayit yok -> kurye GERI VERILIR (ReleaseCourier);
 *   - hala kurye bekliyor         -> atama guncel kayda yeniden yazilir;
 *   - kuryesi yazilmis            -> dokunulmaz (baska ornek once davrandi).
 * Cakisma disi yazim hatasinda kurye birakilmaz: yazim olmus olabilir (Mongo
 * cevabi kayboldu); siparis hala kurye bekliyorsa sonraki tur ayni kuryeyi alir.
 *
 * HATANIN KAYNAGI (D1, T13.2): courier cagrisinin ve depo yaziminin hatasi
 * CourierStepFailure ile kaynagina gore isaretlenir; isci "courier'e
 * ulasilamiyor" ile "depoya ulasilamiyor"u ayirir (gunluk ve metrik etiketi).
 */

import { ERROR_CODES, isAppError, ORDER_STATUS } from '@getir/core';
import type { Clock } from '@getir/core';

import {
  needsCourier,
  releasesCourier,
  withAssignedCourier,
  withCourierRetry,
} from '../domain/courier-dispatch.js';
import { statusChangedEvents } from '../domain/order-events.js';
import type { OrderRepository } from '../domain/order-repository.js';
import type { Order } from '../domain/order.js';
import type { CourierAssignment } from './courier-assignment.js';
import type { RequestScope } from './request-scope.js';

export interface AssignCourierStepDeps {
  readonly repository: Pick<OrderRepository, 'update' | 'findById'>;
  readonly courier: CourierAssignment;
  readonly clock: Clock;
  /** Uygun kurye yoksa bir sonraki denemeye kadar gecen sure (ms). */
  readonly retryDelayMs: number;
  /** Atama yazilamazsa (surum cakismasi) en fazla kac yazim denemesi. */
  readonly writeAttempts: number;
}

export const COURIER_STEP_OUTCOME = {
  /** Kurye siparise yazildi. */
  ASSIGNED: 'assigned',
  /** Markette bos kurye yok: siparis kuryesiz PREPARING'de bekliyor. */
  NO_COURIER: 'no_courier',
  /** Siparis atama sirasinda kapandi: kurye courier-svc'ye geri verildi. */
  RELEASED: 'released',
  /** Baska bir yazim once davrandi: dokunulmadi, gerekirse sonraki turda. */
  SKIPPED: 'skipped',
} as const;

export type CourierStepOutcome = (typeof COURIER_STEP_OUTCOME)[keyof typeof COURIER_STEP_OUTCOME];

/** Hatanin kaynagi (D1): metrik etiketi ve ulasilamama gunlugu bunu kullanir. */
export const DISPATCH_SOURCE = {
  /** courier-svc cagrisi (atama, birakma). */
  COURIER: 'courier',
  /** Siparis deposu (Mongo ya da bellek): okuma ve yazim. */
  STORE: 'store',
  /** Order'in kendisi: beklenmeyen hata (kural ya da kod). */
  ORDER: 'order',
} as const;

export type DispatchSource = (typeof DISPATCH_SOURCE)[keyof typeof DISPATCH_SOURCE];

/** Kaynagi belli hata (D1): asil hata `cause`'da. */
export class CourierStepFailure extends Error {
  constructor(
    readonly source: DispatchSource,
    override readonly cause: unknown,
  ) {
    super(`kurye adimi basarisiz (${source})`);
    this.name = 'CourierStepFailure';
  }
}

/** Hatanin kaynagi ve asil hatasi; isaretsiz hata order'in kendisinindir. */
export function failureOf(error: unknown): {
  readonly source: DispatchSource;
  readonly error: unknown;
} {
  return error instanceof CourierStepFailure
    ? { source: error.source, error: error.cause }
    : { source: DISPATCH_SOURCE.ORDER, error };
}

/** Cagriyi calistirir; hatasini kaynagiyla isaretler. */
async function fromSource<T>(source: DispatchSource, call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (error: unknown) {
    throw new CourierStepFailure(source, error);
  }
}

/** Kurye bekleyen siparise (courier-dispatch.ts isCourierDue) kurye ister ve yazar. */
export async function assignCourierStep(
  deps: AssignCourierStepDeps,
  order: Order,
  scope: RequestScope,
): Promise<CourierStepOutcome> {
  const assigned = await fromSource(DISPATCH_SOURCE.COURIER, () =>
    deps.courier.assign(
      { orderId: order.id, marketId: order.marketId, deliveryLocation: order.deliveryLocation },
      scope,
    ),
  );
  if (assigned === null) {
    return waitForCourier(deps, order, scope);
  }
  return bindCourier(deps, order, assigned.courierId, scope);
}

/**
 * Uygun kurye yok (courier "yok" dedi ya da ayni turda ayni market icin demin
 * dedi; dispatch-couriers.ts). Odenmis siparis kuryesiz PREPARING'e gecer,
 * deneme ani yazilir; INFO yalnizca bu geciste (D2).
 *
 * Zaten bekleyen siparis YAZILMAZ (QA O2): durumu ayni, surumu artmaz; isci
 * onu sirasi geldikce (talep olunca ya da deneme ani gecmisse her turda) yine
 * dener. Her yeni odemede butun bekleyenler yeniden yazilmaz. Yalnizca metrik
 * ve DEBUG.
 */
export async function waitForCourier(
  deps: AssignCourierStepDeps,
  order: Order,
  scope: RequestScope,
): Promise<CourierStepOutcome> {
  if (order.status !== ORDER_STATUS.PAID) {
    scope.logger.debug(
      { orderId: order.id, marketId: order.marketId },
      'bekleyen siparise yine bos kurye yok',
    );
    return COURIER_STEP_OUTCOME.NO_COURIER;
  }
  const retryAt = new Date(deps.clock.now() + deps.retryDelayMs);
  if (!(await writeOrder(deps, order, withCourierRetry(order, retryAt, deps.clock)))) {
    // Kurye alinmadi; siparisin yeni hali sonraki turda yeniden degerlendirilir.
    return COURIER_STEP_OUTCOME.SKIPPED;
  }
  scope.logger.info(
    { orderId: order.id, marketId: order.marketId, retryAt },
    'markette bos kurye yok; siparis kuryesiz bekliyor, sonra yeniden denenecek',
  );
  return COURIER_STEP_OUTCOME.NO_COURIER;
}

/** Alinan kuryeyi siparise yazar; siparis o arada kapandiysa kuryeyi geri verir. */
async function bindCourier(
  deps: AssignCourierStepDeps,
  order: Order,
  courierId: string,
  scope: RequestScope,
): Promise<CourierStepOutcome> {
  let current = order;
  for (let attempt = 1; ; attempt += 1) {
    if (await writeOrder(deps, current, withAssignedCourier(current, courierId, deps.clock))) {
      scope.logger.info(
        { orderId: order.id, courierId, from: current.status },
        'kurye siparise yazildi',
      );
      return COURIER_STEP_OUTCOME.ASSIGNED;
    }
    const latest = await fromSource(DISPATCH_SOURCE.STORE, () =>
      deps.repository.findById(order.id),
    );
    if (latest === null || releasesCourier(latest)) {
      const released = await fromSource(DISPATCH_SOURCE.COURIER, () =>
        deps.courier.release(order.id, scope),
      );
      scope.logger.warn(
        { orderId: order.id, courierId, status: latest?.status ?? null, released },
        'siparis kurye atanirken kapandi; kurye geri verildi',
      );
      return COURIER_STEP_OUTCOME.RELEASED;
    }
    if (!needsCourier(latest) || attempt >= deps.writeAttempts) {
      return COURIER_STEP_OUTCOME.SKIPPED;
    }
    current = latest;
  }
}

/**
 * Surum kontrollu yazar; durum gecisi varsa olayi ayni yazimdadir.
 * @returns yazildi mi? (false: surum cakismasi, siparis baska yolda degisti)
 */
async function writeOrder(
  deps: AssignCourierStepDeps,
  before: Order,
  after: Order,
): Promise<boolean> {
  try {
    await deps.repository.update(after, before.version, statusChangedEvents(before, after));
    return true;
  } catch (error: unknown) {
    if (isAppError(error) && error.code === ERROR_CODES.CONFLICT) {
      return false;
    }
    throw new CourierStepFailure(DISPATCH_SOURCE.STORE, error);
  }
}
