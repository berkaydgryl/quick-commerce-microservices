/**
 * Tutar degismezleri. Para KURUS cinsinden TAM SAYIDIR; float ikili kayan
 * noktada 0,1 + 0,2 gibi toplamlarda yuvarlama hatasi uretir ve sepet toplami
 * ile odenen tutar tutmaz.
 */

import { AppError } from '@getir/core';

/** Negatif olmayan tam sayi mi? Degilse programci hatasidir (VALIDATION_FAILED). */
export function assertMinor(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw AppError.validation('Tutar kurus cinsinden negatif olmayan tam sayi olmali', {
      details: { field },
    });
  }
}

/** Tutari sifirin altina dusurmez. */
export function clampToZero(value: number): number {
  return Math.max(0, value);
}
