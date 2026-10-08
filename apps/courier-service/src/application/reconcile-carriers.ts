/**
 * Use-case: BUSY kalan kurye uzlastirmasi (#205): tick'in seyrek adimi.
 *
 * Iptalde rota ENDED yazilip kurye birakmasi dustuyse (ara hata) ve order'in
 * tekrarlari da tutmadiysa kurye BUSY kalir: tick ENDED rotaya bakmaz, kurye
 * havuzdan duser. Burada bulunur ve birakilir:
 *   - kurye BUSY, siparisi HALA tasiyor ve rota BU atamanin (belongsToAssignment);
 *   - rota ENDED (iptal kazandi): kurye bitis anindaki konumda (#174 kurallari,
 *     positionAt); ya da rota teslimli ve DONE: kurye adreste, teslim aninda;
 *   - rota en az `graceMs` once bitmis (ReleaseCourier'in kendi birakmasiyla
 *     yarismasin). Bitis ani olmayan ENDED rotada kurye simdi, konumu degismeden.
 * Ilerleyen (MOVING) rota normal yoldur, dokunulmaz; rotasiz atama da.
 *
 * SAYFALI ve TOPLU: siparis tasiyan kuryeler siparis kimligine gore sayfa sayfa
 * (her kosuda sonraki sayfa, sona gelince basa) ve sayfanin rotalari tek okumayla
 * (N+1 yok); atlanan kuryeler pencereyi kilitlemez. Birakma {_id,
 * currentOrderId} kosullu: tekrar guvenli, ReleaseCourier ile yarisirsa biri
 * kazanir. Her birakmadan once `shouldContinue` sorulur (tur butcesi). Mongo
 * transaction'i yerine bu sade yol secildi (README).
 */

import type { Clock, Logger } from '@getir/core';

import { COURIER_STATUS } from '../domain/courier.js';
import type { Courier, GeoPoint } from '../domain/courier.js';
import type { CarrierReader, CourierRepository } from '../domain/courier-repository.js';
import { belongsToAssignment, isDelivered, ROUTE_STATE, routeState } from '../domain/route.js';
import type { Route } from '../domain/route.js';
import type { MovementRule } from '../domain/route-progress.js';
import { dropoffOf, positionAt } from '../domain/route-progress.js';
import type { RouteBatchReader } from '../domain/route-repository.js';

export interface ReconcileCarriersDeps {
  readonly couriers: CarrierReader & Pick<CourierRepository, 'releaseByOrder'>;
  readonly routes: RouteBatchReader;
  /** #197 oncesi (kuralsiz) rotanin o anki hareket kurali. */
  readonly rule: MovementRule;
  /** Bir kosuda en fazla bu kadar kurye (sayfa). */
  readonly batchSize: number;
  /** Rota en az bu kadar once bitmis olmali (ms). */
  readonly graceMs: number;
  readonly clock: Clock;
}

/** @returns Birakilan kurye sayisi. `shouldContinue` false ise kalanlar sonraki kosuda. */
export type ReconcileCarriers = (logger: Logger, shouldContinue?: () => boolean) => Promise<number>;

/** Takili kuryenin birakilma ani ve (varsa) konumu. */
interface StuckRelease {
  readonly at: Date;
  readonly location?: GeoPoint;
}

export function createReconcileCarriers(deps: ReconcileCarriersDeps): ReconcileCarriers {
  let afterOrderId: string | undefined;
  return async (logger, shouldContinue = () => true) => {
    const carriers = await deps.couriers.listCarrying(deps.batchSize, afterOrderId);
    // Son sayfa (eksik) ise bir sonraki kosu bastan baslar.
    afterOrderId = carriers.length < deps.batchSize ? undefined : carriers.at(-1)?.currentOrderId;
    if (carriers.length === 0) {
      return 0;
    }
    const orderIds = carriers.flatMap((carrier) =>
      carrier.currentOrderId === undefined ? [] : [carrier.currentOrderId],
    );
    const routes = new Map(
      (await deps.routes.findByOrders(orderIds)).map((route) => [route.orderId, route]),
    );
    const now = deps.clock.now();
    let released = 0;
    for (const carrier of carriers) {
      const route = routes.get(carrier.currentOrderId ?? '');
      const stuck = route === undefined ? null : stuckRelease(carrier, route, now, deps);
      if (route === undefined || stuck === null) {
        continue;
      }
      if (!shouldContinue()) {
        break;
      }
      const freed = await deps.couriers.releaseByOrder(route.orderId, stuck.at, {
        courierId: carrier.id,
        ...(stuck.location === undefined ? {} : { location: stuck.location }),
      });
      if (freed !== null) {
        released += 1;
        logger.warn(
          { orderId: route.orderId, courierId: carrier.id, state: routeState(route) },
          'BUSY kalan kurye uzlastirildi: rotasi bitmis, kurye birakildi',
        );
      }
    }
    return released;
  };
}

/**
 * Kurye takili mi: BUSY, rota bu atamanin ve bekleme payindan once bitmis
 * (ENDED ya da teslimli DONE). Degilse null (normal yol ya da baska atama).
 */
function stuckRelease(
  carrier: Courier,
  route: Route,
  now: number,
  deps: Pick<ReconcileCarriersDeps, 'graceMs' | 'rule'>,
): StuckRelease | null {
  if (carrier.status !== COURIER_STATUS.BUSY || !belongsToAssignment(route, carrier)) {
    return null;
  }
  const settled = (at: Date) => at.getTime() <= now - deps.graceMs;
  const state = routeState(route);
  if (state === ROUTE_STATE.ENDED) {
    if (route.endedAt === undefined) {
      return { at: new Date(now) };
    }
    return settled(route.endedAt)
      ? { at: route.endedAt, location: positionAt(route, route.endedAt, deps.rule) }
      : null;
  }
  if (state === ROUTE_STATE.DONE && isDelivered(route) && route.deliveredAt !== undefined) {
    const dropoff = dropoffOf(route);
    return settled(route.deliveredAt)
      ? { at: route.deliveredAt, ...(dropoff === undefined ? {} : { location: dropoff }) }
      : null;
  }
  return null;
}
