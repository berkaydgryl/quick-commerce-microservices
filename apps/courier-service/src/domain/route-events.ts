/**
 * Rotanin kilometre taslarinin yayini (T13.3): paket alindi, teslim edildi.
 * Olaylar order'a gider (T14.3); govdeler @getir/contracts events.ts'te.
 *
 * Yayin EN AZ BIR KEZ: tick, rota "yayinlandi" isaretini alana kadar her turda
 * yeniden yayinlar (rota belgesi bir outbox gibi). Basari = olay hatta kalici.
 */

import type { Route } from './route.js';

export interface RouteEventPublisher {
  /** courier.picked_up: rotanin marketi bilinmeli (T13.3 oncesi rotada olay yok). */
  pickedUp(route: Route & { readonly marketId: string }, at: Date): Promise<void>;
  /** courier.delivered. */
  delivered(route: Route, at: Date): Promise<void>;
}
