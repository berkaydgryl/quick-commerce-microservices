/**
 * Odeme formunun kurallari (T17.1; B2, sozlesmenin giftDetailsSchema'si): hediye acikken alici adi ve
 * Turkiye cep telefonu zorunlu, kapaliyken hata yok; secili kart suresi
 * gecmemis en yeni kart (M4). Arayuzden bagimsiz.
 */

import { PHONE_MESSAGE, RECIPIENT_NAME_MESSAGE } from '@getir/contracts';
import type { SavedCard } from '@getir/contracts';
import { describe, expect, it } from 'vitest';

import {
  EMPTY_CHECKOUT_FORM,
  giftFieldErrors,
} from '../../src/features/checkout/services/checkout-rules';
import { defaultCard } from '../../src/features/checkout/services/selected-card';

const GIFT = { ...EMPTY_CHECKOUT_FORM.gift, enabled: true };

const card = (id: string, createdAt: string, expired = false): SavedCard => ({
  id: `crd_${id.padEnd(32, '0')}`,
  brand: 'VISA',
  first4: '4242',
  last4: '4242',
  expiryMonth: 12,
  expiryYear: 2030,
  holderName: 'AYSE YILMAZ',
  expired,
  createdAt,
});

describe('giftFieldErrors (T17.1)', () => {
  it('hediye kapaliyken hata yok (alanlar bos olsa da)', () => {
    expect(giftFieldErrors(EMPTY_CHECKOUT_FORM.gift)).toEqual({});
  });

  it('hediye acik, alanlar bos: alici adi ve telefonu zorunlu', () => {
    expect(giftFieldErrors(GIFT)).toEqual({
      recipientName: RECIPIENT_NAME_MESSAGE,
      recipientPhone: PHONE_MESSAGE,
    });
  });

  it('yalnizca bosluk olan ad gecersiz; 5 ile baslamayan ya da eksik numara gecersiz', () => {
    expect(
      giftFieldErrors({ ...GIFT, recipientName: '   ', recipientPhone: '5321234567' }),
    ).toEqual({
      recipientName: RECIPIENT_NAME_MESSAGE,
    });
    expect(
      giftFieldErrors({ ...GIFT, recipientName: 'Ali', recipientPhone: '4321234567' }),
    ).toEqual({
      recipientPhone: PHONE_MESSAGE,
    });
    expect(giftFieldErrors({ ...GIFT, recipientName: 'Ali', recipientPhone: '532123456' })).toEqual(
      {
        recipientPhone: PHONE_MESSAGE,
      },
    );
  });

  it('ad ve gecerli cep numarasi: hata yok (gonderici adi ve not istege bagli)', () => {
    expect(
      giftFieldErrors({ ...GIFT, recipientName: 'Ali', recipientPhone: '5321234567' }),
    ).toEqual({});
  });
});

describe('defaultCard (T17.1, M4)', () => {
  it('suresi gecmemis EN YENI kart; sira girdiden bagimsiz', () => {
    const eski = card('a', '2026-09-01T10:00:00.000Z');
    const yeni = card('b', '2026-10-01T10:00:00.000Z');

    expect(defaultCard([eski, yeni])).toBe(yeni);
    expect(defaultCard([yeni, eski])).toBe(yeni);
  });

  it('en yeni kartin suresi gectiyse bir onceki gecerli kart', () => {
    const gecerli = card('a', '2026-09-01T10:00:00.000Z');
    const suresiGecmis = card('b', '2026-10-01T10:00:00.000Z', true);

    expect(defaultCard([suresiGecmis, gecerli])).toBe(gecerli);
  });

  it('kart yok ya da hepsinin suresi gecmis: secili kart yok', () => {
    expect(defaultCard([])).toBeUndefined();
    expect(defaultCard([card('a', '2026-09-01T10:00:00.000Z', true)])).toBeUndefined();
  });
});
