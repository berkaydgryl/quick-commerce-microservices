/**
 * Kartin yuzu (T11.17, tasarim B): numaranin gorunen hali ve kartin adi. Saf
 * fonksiyonlar. Kartin yuzune TAM NUMARA GITMEZ (M7): yazilan hanelerden
 * yalnizca ilk 4 ve son 4 gorunur, digerleri "•"; yazilmayan yerler "#".
 * Kayitli kartta zaten yalnizca ilk 4 ve son 4 vardir.
 */

import type { CardBrand, CardBrandLabels, SavedCard } from '@getir/contracts';

import { numberGroupSizes } from './card-input';

export type CardFaceCharKind = 'digit' | 'masked' | 'empty';

export interface CardFaceChar {
  readonly char: string;
  readonly kind: CardFaceCharKind;
}

export type CardFaceGroups = readonly (readonly CardFaceChar[])[];

const MASK = '•';
const EMPTY = '#';
/** Numaranin bastan ve sondan gorunen hane sayisi. */
const VISIBLE_EDGE = 4;

/** Gruplara bolunmus yerler; her yerin karakterini `charAt` verir. */
function groupsOf(
  sizes: readonly number[],
  charAt: (index: number, total: number) => CardFaceChar,
) {
  const total = sizes.reduce((sum, size) => sum + size, 0);
  let index = 0;
  return sizes.map((size) =>
    Array.from({ length: size }, () => {
      const position = index;
      index += 1;
      return charAt(position, total);
    }),
  );
}

const isEdge = (index: number, total: number) =>
  index < VISIBLE_EDGE || index >= total - VISIBLE_EDGE;

/** Yazilan numaranin yuzu: ilk 4 ve son 4 hane, aradakiler •, eksikler #. */
export function typedCardFace(digits: string, brand: CardBrand | null): CardFaceGroups {
  return groupsOf(numberGroupSizes(brand, digits.length), (index, total) => {
    const digit = digits[index];
    if (digit === undefined) {
      return { char: EMPTY, kind: 'empty' };
    }
    return isEdge(index, total) ? { char: digit, kind: 'digit' } : { char: MASK, kind: 'masked' };
  });
}

/** Kayitli kartin yuzu: ilk 4 + • + son 4 (Amex 15, digerleri 16 hane yeri). */
export function savedCardFace(card: Pick<SavedCard, 'brand' | 'first4' | 'last4'>): CardFaceGroups {
  const sizes = numberGroupSizes(card.brand, 0);
  return groupsOf(sizes, (index, total) => {
    if (index < VISIBLE_EDGE) {
      return { char: card.first4[index] ?? MASK, kind: 'digit' };
    }
    if (index >= total - VISIBLE_EDGE) {
      return { char: card.last4[index - (total - VISIBLE_EDGE)] ?? MASK, kind: 'digit' };
    }
    return { char: MASK, kind: 'masked' };
  });
}

/** Kartin kisa adi: "Visa •••• 4242" (silme sorusu, bildirim, erisilebilir ad). */
export function cardShortName(
  card: Pick<SavedCard, 'brand' | 'last4'>,
  labels: CardBrandLabels,
): string {
  return `${labels[card.brand]} ${MASK.repeat(VISIBLE_EDGE)} ${card.last4}`;
}

/** Son kullanma: 8, 2029 -> "08/29". */
export function formatCardExpiry(month: number, year: number): string {
  return `${String(month).padStart(2, '0')}/${String(year % 100).padStart(2, '0')}`;
}

/** Kartin uzerindeki ad: buyuk harf (Turkce kurallariyla); bossa yer tutucu. */
export function faceHolderName(name: string, placeholder: string): string {
  const trimmed = name.trim();
  return trimmed === '' ? placeholder : trimmed.toLocaleUpperCase('tr-TR');
}
