/**
 * Oda modeli (T12.1, docs/api/socket-events.md "Odalar").
 *
 * Iki oda turu vardir ve yetki kurallari farklidir (B28):
 *  - order:{orderId}  -> yalnizca siparisin sahibi, oda jetonuyla girer.
 *  - store:{marketId} -> herkese acik (anonim dahil); yalnizca stock.changed tasir.
 *
 * Oda adi istemciden gelir: "order:" + rastgele metin ya da "store:../.." odaya
 * donusmemeli. Bicim kurali contracts roomSchema ile AYNI kimlik semalarindan
 * gelir; burada ad, turune ve kimligine ayrilir. Ayristirilamayan ad hicbir
 * odaya katilamaz.
 */

import { marketIdSchema, orderIdSchema, ROOM_PREFIX } from '@getir/contracts';

/** Oda turleri; metrik etiketi olarak da kullanilir (kapali kume). */
export const ROOM_KINDS = {
  ORDER: 'order',
  STORE: 'store',
} as const;

export type RoomKind = (typeof ROOM_KINDS)[keyof typeof ROOM_KINDS];

export type Room =
  | { readonly kind: typeof ROOM_KINDS.ORDER; readonly name: string; readonly orderId: string }
  | { readonly kind: typeof ROOM_KINDS.STORE; readonly name: string; readonly marketId: string };

/** Oda adini ayristirir; bicim disiysa undefined (cagiran VALIDATION_FAILED doner). */
export function parseRoom(name: string): Room | undefined {
  if (name.startsWith(ROOM_PREFIX.order)) {
    const orderId = name.slice(ROOM_PREFIX.order.length);
    return orderIdSchema.safeParse(orderId).success
      ? { kind: ROOM_KINDS.ORDER, name, orderId }
      : undefined;
  }
  if (name.startsWith(ROOM_PREFIX.store)) {
    const marketId = name.slice(ROOM_PREFIX.store.length);
    return marketIdSchema.safeParse(marketId).success
      ? { kind: ROOM_KINDS.STORE, name, marketId }
      : undefined;
  }
  return undefined;
}
