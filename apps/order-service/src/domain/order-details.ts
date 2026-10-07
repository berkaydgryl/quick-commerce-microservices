/**
 * Siparis ayrintilari (T12.4; B2): hediye, kuryeye not, "Zili Çalma" ve
 * sozlesme onayinin ani. Kurallar (@getir/contracts checkout-rules.ts) gRPC
 * semasinda dogrulanir; burasi saf model.
 *
 * Kisisel veri (alici ve gonderici adi, telefon, not, hediye mesaji): gunluge,
 * ize ve olaylara (outbox) YAZILMAZ; yalnizca siparis belgesinde durur ve
 * yalnizca siparisin SAHIBINE doner (GetOrder). Saklama suresi bekleyen is 133.
 */

import type { Clock } from '@getir/core';

import type { Order } from './order.js';

export interface GiftDetails {
  readonly message: string;
  readonly senderName: string;
  readonly recipientName: string;
  /** E.164 ("+905321234567"). */
  readonly recipientPhone: string;
}

/** Istekten gelen ayrinti; sozlesme onayi semada dogrulandi (true). */
export interface OrderDetailsInput {
  readonly gift?: GiftDetails | undefined;
  readonly note: string;
  readonly doNotRingBell: boolean;
}

/** Siparise yazilan ayrinti: onayin ani SUNUCU saatiyle. */
export interface OrderDetails extends OrderDetailsInput {
  readonly agreementsAcceptedAt: Date;
}

/** Onaylanmis ayrinti: kabul ani simdi (siparisin saati). */
export function acceptDetails(input: OrderDetailsInput, clock: Clock): OrderDetails {
  return {
    ...(input.gift === undefined ? {} : { gift: input.gift }),
    note: input.note,
    doNotRingBell: input.doNotRingBell,
    agreementsAcceptedAt: clock.date(),
  };
}

/**
 * Yeniden denemedeki ayrinti ilk yazilandan farkli mi? Ayrinti risk adiminda
 * bir kez yazilir, sonraki denemeler onu DEGISTIRMEZ (ilk onay ve ilk not
 * gecerli); fark yalnizca bilinsin diye sorulur (deger gunluge YAZILMAZ).
 */
export function differsFromRecorded(order: Order, input: OrderDetailsInput): boolean {
  const recorded = order.details;
  if (recorded === undefined) {
    return false;
  }
  return (
    recorded.note !== input.note ||
    recorded.doNotRingBell !== input.doNotRingBell ||
    !sameGift(recorded.gift, input.gift)
  );
}

/** Alan alan karsilastirma: anahtar sirasi (Mongo, sema) sonucu degistirmez. */
function sameGift(left: GiftDetails | undefined, right: GiftDetails | undefined): boolean {
  if (left === undefined || right === undefined) {
    return left === right;
  }
  return (
    left.message === right.message &&
    left.senderName === right.senderName &&
    left.recipientName === right.recipientName &&
    left.recipientPhone === right.recipientPhone
  );
}
