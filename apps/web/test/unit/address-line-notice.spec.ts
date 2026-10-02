/**
 * "Bu adresi kullan"dan sonra satir ve uyari (T11.8): adres yoksa icerikteki
 * uyari, servis yogunsa sunucunun mesaji; iki durumda da satir bos (kullanici yazar).
 */

import { errorMessage } from '@getir/contracts';
import { AppError, ERROR_CODES } from '@getir/core';
import { describe, expect, it } from 'vitest';

import { resolvedLine, unresolvedLine } from '../../src/features/address/services/line-notice';

const UNRESOLVED = 'Bu nokta için adres bulunamadı; adresini kendin yazabilirsin.';

describe('line-notice', () => {
  it('cozulen satir uyarisiz', () => {
    expect(resolvedLine('Moda Caddesi')).toEqual({ line: 'Moda Caddesi', notice: null });
  });

  it('NOT_FOUND: icerikteki uyari', () => {
    const error = new AppError(ERROR_CODES.NOT_FOUND, errorMessage(ERROR_CODES.NOT_FOUND));

    expect(unresolvedLine(error, UNRESOLVED)).toEqual({ line: '', notice: UNRESOLVED });
  });

  it('SERVICE_UNAVAILABLE: sunucunun mesaji', () => {
    const message = errorMessage(ERROR_CODES.SERVICE_UNAVAILABLE);
    const error = new AppError(ERROR_CODES.SERVICE_UNAVAILABLE, message);

    expect(unresolvedLine(error, UNRESOLVED)).toEqual({ line: '', notice: message });
  });

  it('beklenmeyen hata: genel mesaj', () => {
    expect(unresolvedLine(new Error('x'), UNRESOLVED)).toEqual({
      line: '',
      notice: errorMessage(ERROR_CODES.INTERNAL),
    });
  });
});
