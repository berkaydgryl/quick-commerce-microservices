/**
 * Gosterim bicimleri: saf fonksiyonlar, React ve fetch yok (roadmap: hesap
 * bilesende degil servistedir). Para her yerde KURUS tam sayidir; 100'e bolme
 * YALNIZCA burada, gosterim aninda yapilir.
 */

import type { DeliveryTime, Money } from '@getir/contracts';

const LOCALE = 'tr-TR';
const MINOR_UNITS_PER_LIRA = 100;
const METERS_PER_KILOMETER = 1000;

const moneyFormat = new Intl.NumberFormat(LOCALE, {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const kilometerFormat = new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 1 });
const ratingFormat = new Intl.NumberFormat(LOCALE, {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

/** 4599 -> "45,99 TL". Sozlesmede tek para birimi TRY'dir. */
export function formatMoney(money: Money): string {
  return `${moneyFormat.format(money.amountMinor / MINOR_UNITS_PER_LIRA)} TL`;
}

/** 405 -> "405 m", 1250 -> "1,3 km". */
export function formatDistance(meters: number): string {
  return meters < METERS_PER_KILOMETER
    ? `${meters} m`
    : `${kilometerFormat.format(meters / METERS_PER_KILOMETER)} km`;
}

/** { 15, 25 } -> "15-25 dk"; esitse tek deger. */
export function formatDeliveryTime({ minMinutes, maxMinutes }: DeliveryTime): string {
  return minMinutes === maxMinutes ? `${minMinutes} dk` : `${minMinutes}-${maxMinutes} dk`;
}

/** 4.7 -> "4,7". */
export function formatRating(average: number): string {
  return ratingFormat.format(average);
}
