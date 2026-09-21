import { ERROR_CODES } from '@getir/core';
import { describe, expect, it } from 'vitest';

import { ERROR_MESSAGES, errorMessage, toApiError } from '../../src/index.js';

const REQUEST_ID = 'req_0123456789abcdef';

describe('ERROR_MESSAGES', () => {
  it('core icindeki her kod icin bir mesaj tasir', () => {
    // Record<ErrorCode, string> zaten derleme zamaninda eksiksizligi zorunlu
    // kilar; bu kontrol ayni sartin calisma zamaninda da gorunur olmasi icin.
    expect(Object.keys(ERROR_MESSAGES).sort()).toEqual(Object.values(ERROR_CODES).sort());
  });

  it('fazladan kod tanimlamaz', () => {
    expect(Object.keys(ERROR_MESSAGES)).toHaveLength(Object.keys(ERROR_CODES).length);
  });

  it('mesajlar bos degildir ve hata kodunu ham haliyle icermez', () => {
    for (const [code, message] of Object.entries(ERROR_MESSAGES)) {
      expect(message.trim().length).toBeGreaterThan(0);
      // Kullaniciya STOCK_INSUFFICIENT gibi bir anahtar gosterilmez.
      expect(message).not.toContain(code);
    }
  });
});

describe('errorMessage', () => {
  it('sozlesmede ornek verilen iki metni aynen dondurur', () => {
    expect(errorMessage(ERROR_CODES.STOCK_INSUFFICIENT)).toBe('Bu üründen yeterli stok kalmadı.');
    expect(errorMessage(ERROR_CODES.RESERVATION_EXPIRED)).toBe('Süre doldu, sepetini yenileyelim.');
  });
});

describe('toApiError', () => {
  it('mesaji sozlukten uretir', () => {
    expect(toApiError(ERROR_CODES.NO_STORE, REQUEST_ID)).toEqual({
      code: ERROR_CODES.NO_STORE,
      message: errorMessage(ERROR_CODES.NO_STORE),
      requestId: REQUEST_ID,
    });
  });

  it('details verilmediginde alani hic koymaz', () => {
    expect(Object.hasOwn(toApiError(ERROR_CODES.INTERNAL, REQUEST_ID), 'details')).toBe(false);
  });

  it('details verildiginde tasir', () => {
    const error = toApiError(ERROR_CODES.STOCK_INSUFFICIENT, REQUEST_ID, {
      sku: 'SUT-1L',
      requested: 3,
      available: 1,
    });

    expect(error.details).toEqual({ sku: 'SUT-1L', requested: 3, available: 1 });
  });
});
