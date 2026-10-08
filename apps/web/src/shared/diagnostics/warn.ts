import { AppError } from '@getir/core';

/**
 * Istemcinin uyari kapisi (F16): tarayici gunlugune tek satir, yapili alanlar.
 * Kisisel veri YAZILMAZ (konum, adres, kimlik, hata metni yok): yalniz olay
 * adi, hata kodu ve gateway'in istek kimligi (requestId; sunucu gunluguyle
 * eslesir). AppError olmayan hata 'UNKNOWN'.
 */
export function warnEvent(event: string, error: unknown): void {
  const fields =
    error instanceof AppError
      ? {
          code: error.code,
          ...(error.requestId === undefined ? {} : { requestId: error.requestId }),
        }
      : { code: 'UNKNOWN' };
  // eslint-disable-next-line no-console -- tek uyari kapisi; icerik olay adi, kod ve istek kimligi.
  console.warn(`[getir] ${event}`, fields);
}
