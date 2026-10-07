import { RATING_MAX } from '@getir/contracts';

/** Bir yildizin dolulugu. */
export type StarFill = 'full' | 'half' | 'empty';

/**
 * Puanin yildizlari (T16.2; referans getircarsi "★★★★☆ 4.43"): RATING_MAX
 * yildiz, puan en yakin yarima yuvarlanir (4,43 -> 4,5: dort dolu, bir yarim).
 * Sayi ayrica yazilir; yildizlar yalnizca gorseldir.
 */
export function ratingStars(average: number): readonly StarFill[] {
  const halves = Math.round(average * 2);
  return Array.from({ length: RATING_MAX }, (_, index): StarFill => {
    const left = halves - index * 2;
    if (left >= 2) {
      return 'full';
    }
    return left === 1 ? 'half' : 'empty';
  });
}
