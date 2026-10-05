/**
 * routes deposu PORTU (T13.2). Iki uygulamasi var (bellek, Mongo); ayni
 * sozlesme testinden gecer.
 */

import type { Route } from './route.js';

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
