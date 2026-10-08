/**
 * Kurye penceresinin sayilari (F22): tahmini varis ("~8 dk") ve kalan mesafe
 * ("1,2 km", "300 m"; ekran disi gostergede de); kuryenin kisaltilmis adi ("Mehmet K."). Saf
 * fonksiyonlar; birimler icerikten.
 */

import type { CourierTrackingContent } from '@getir/contracts';

const KILOMETERS = new Intl.NumberFormat('tr-TR', {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});
const METERS_PER_KILOMETER = 1000;
/** Metre 10'a yuvarlanir: 2 sn'de bir titreyen birler basamagi gosterilmez. */
const METER_STEP = 10;

/** Dakikaya yukari yuvarlanir; varmadan "~0 dk" yazilmaz (en az 1). */
export function etaText(
  seconds: number,
  texts: Pick<CourierTrackingContent, 'etaPrefix' | 'minuteSuffix'>,
): string {
  const minutes = Math.max(1, Math.ceil(seconds / 60));
  return `${texts.etaPrefix}${minutes} ${texts.minuteSuffix}`;
}

/** 1 km altinda metre (10'luk), ustunde tek ondalikli km. */
export function distanceText(
  meters: number,
  texts: Pick<CourierTrackingContent, 'kilometerSuffix' | 'meterSuffix'>,
): string {
  const rounded = Math.round(meters / METER_STEP) * METER_STEP;
  if (rounded < METERS_PER_KILOMETER) {
    return `${rounded} ${texts.meterSuffix}`;
  }
  return `${KILOMETERS.format(meters / METERS_PER_KILOMETER)} ${texts.kilometerSuffix}`;
}

/**
 * Kisaltilmis ad (PM: kisisel veri asgari): son ad bas harfine iner
 * ("Mehmet Kaya" -> "Mehmet K."); zaten kisaltilmissa ya da tek adsa aynen.
 */
export function courierDisplayName(name: string): string {
  const parts = name.trim().split(/\s+/u);
  const last = parts.at(-1) ?? '';
  if (parts.length < 2 || /^\p{L}\.$/u.test(last)) {
    return parts.join(' ');
  }
  const initial = [...last][0]?.toLocaleUpperCase('tr-TR') ?? '';
  return [...parts.slice(0, -1), `${initial}.`].join(' ');
}
