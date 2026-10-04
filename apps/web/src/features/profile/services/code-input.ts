/**
 * Dogrulama kodu alani (T11.14): yalnizca rakam, en fazla 6. Yapistirilan
 * "042 137" ya da "Kod: 042137" da 6 rakama iner (telefon alanindaki kural).
 */

import { OTP_PATTERN } from '@getir/contracts';

/** Kodun rakam sayisi (OTP_PATTERN: tam 6 rakam). */
export const CODE_LENGTH = 6;

export function codeDigits(value: string): string {
  return value.replace(/\D/g, '').slice(0, CODE_LENGTH);
}

/** Kod tamam mi (sozlesmenin kurali). */
export function isCompleteCode(value: string): boolean {
  return OTP_PATTERN.test(value);
}
