/**
 * routes deposu PORTU (T13.2). Iki uygulamasi var (bellek, Mongo); ayni
 * sozlesme testinden gecer.
 */

import type { Route, RoutePatch } from './route.js';

export interface RouteRepository {
  findByOrder(orderId: string): Promise<Route | null>;

  /**
   * Rotayi BIR KEZ yazar: siparisin rotasi zaten varsa dokunmaz, var olani
   * doner (eszamanli iki atama istegi ayni rotayi gorur).
   */
  insertOnce(route: Route): Promise<Route>;

  /** Siparisin rotasini degistirir: yalnizca siparis baska kuryeye yeniden atandiysa. */
  replace(route: Route): Promise<void>;
}

/**
 * Ilerleyen rotalarin portu (T13.3 tick ve birakma). Ayni depolar uygular;
 * atama tarafi (RouteRepository) bunlari bilmez.
 */
export interface MovingRouteRepository {
  /**
   * Ilerleyen (MOVING) rotalar, uretilme anina gore eskiden yeniye, en fazla
   * `limit` tane (T13.3 tick).
   */
  listMoving(limit: number): Promise<readonly Route[]>;

  /**
   * Rotaya yamayi yazar; YALNIZCA saklanan rota hala BU rotaysa (ayni kurye,
   * ayni uretilme ani: yeniden atamada yenisiyle degismediyse) ve MOVING ise.
   * @returns Guncel rota; kosul tutmadiysa null (degisiklik yok).
   */
  update(route: Route, patch: RoutePatch): Promise<Route | null>;
}
