/**
 * "Bu adresi kullan"dan sonra adres satirinin durumu (T11.8): SAF kural.
 *
 * Cozulduyse satir dolu gelir, uyari yok. Noktada adres yoksa (404) satir bos
 * ve icerikteki "adresini kendin yazabilirsin" uyarisi; servis yogun ya da
 * ulasilamazsa (503, ag) satir yine bos ve sunucunun mesaji. Iki durumda da
 * 2. adima gecilir: adres formu haritasiz da doldurulabilir.
 */

import { errorMessage } from '@getir/contracts';
import { AppError, ERROR_CODES } from '@getir/core';

export interface ResolvedLine {
  readonly line: string;
  /** Satirin ustundeki uyari; satir cozulduyse null. */
  readonly notice: string | null;
}

export function resolvedLine(line: string): ResolvedLine {
  return { line, notice: null };
}

export function unresolvedLine(error: unknown, unresolvedNotice: string): ResolvedLine {
  if (error instanceof AppError) {
    return {
      line: '',
      notice: error.code === ERROR_CODES.NOT_FOUND ? unresolvedNotice : error.message,
    };
  }
  return { line: '', notice: errorMessage(ERROR_CODES.INTERNAL) };
}
