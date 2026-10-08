import type { CheckoutContent } from '@getir/contracts';
import { AppError, ERROR_CODES } from '@getir/core';

import { userMessage } from './user-message';

/** Bankanin dogrulama kodu 6 hanedir (T12.4). */
export const OTP_LENGTH = 6;

/**
 * Kod gonderilebilir mi: 6 hane, onceki deneme surmuyor ve cok fazla hatali
 * kod beklemesi (429; F15b) yok. "Onayla"nin pasifligi ve formun gonderimi
 * AYNI kurala bakar.
 */
export function canSubmitCode(otp: string, verifying: boolean, waitSeconds: number): boolean {
  return otp.length === OTP_LENGTH && !verifying && waitSeconds <= 0;
}

/**
 * Kod denemesi hatayla bitti, siparis birakilacak: hak bittiyse (402
 * THREEDS_FAILED, kalan hak yok) yenilemedeki gibi "Doğrulama hakkın bitti";
 * aksi halde sunucunun cumlesi (F15b; ayni olay ayni metin).
 */
export function codeFailureNotice(
  error: unknown,
  texts: Pick<CheckoutContent, 'threeDsExhaustedToast'>,
): string {
  return error instanceof AppError && error.code === ERROR_CODES.THREEDS_FAILED
    ? texts.threeDsExhaustedToast
    : userMessage(error);
}
