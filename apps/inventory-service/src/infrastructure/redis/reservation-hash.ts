/**
 * Rezervasyon hash'inin on okumasi (release.lua'dan once, T10.2): script'in
 * dokunacagi sayaclar ve kullanici kilidi KEYS'te bildirilmek zorunda, bunlar
 * da ancak hash'ten ogrenilir. Hash reserve.lua'nin yazdigi bicimdedir
 * (qty:{sku}, userId...). Bozuksa tahmin yurutulmez: INTERNAL.
 *
 * Okuma ile script arasinda kayit degisebilir; karar script'indir, burasi
 * yalnizca anahtarlari hazirlar.
 */

import { AppError } from '@getir/core';

import type { ReservationLine } from '../../domain/reservation.js';

const QUANTITY_FIELD_PREFIX = 'qty:';
const POSITIVE_INTEGER = /^[1-9]\d*$/;

export interface ReservationHash {
  readonly userId: string;
  /** SKU sirasinda. */
  readonly lines: readonly ReservationLine[];
}

/** HGETALL cevabi -> kayit; hash yoksa (bos cevap) undefined. */
export function readReservationHash(
  fields: Readonly<Record<string, string>>,
  where: { readonly orderId: string; readonly marketId: string },
): ReservationHash | undefined {
  if (Object.keys(fields).length === 0) {
    return undefined;
  }

  const userId = fields['userId'];
  const lines: ReservationLine[] = [];
  for (const [name, value] of Object.entries(fields)) {
    if (!name.startsWith(QUANTITY_FIELD_PREFIX)) {
      continue;
    }
    if (!POSITIVE_INTEGER.test(value)) {
      throw AppError.internal('rezervasyon kaydinda bozuk adet', {
        details: { ...where, field: name },
      });
    }
    lines.push({ sku: name.slice(QUANTITY_FIELD_PREFIX.length), quantity: Number(value) });
  }
  if (userId === undefined || userId === '') {
    throw AppError.internal('rezervasyon kaydinda kullanici yok', { details: { ...where } });
  }
  return { userId, lines: lines.sort((left, right) => left.sku.localeCompare(right.sku)) };
}
