/**
 * Odeme sayfasinin gorunumleri (T17.1; referans getircarsi; KAMPANYA YOK):
 * anahtar ve sayacli alan, Hediye Bilgileri (kapali/acik, zorunlu alanlar,
 * hata), Teslimat Yöntemi (etiketsiz, K4), Ödeme Yöntemi (secili kart yalnizca
 * ilk 4 ve son 4 hane; "Değiştir" ve "Kart ekle" F5'e kadar pasif, M4), Ödeme
 * Özeti (teslimat satiri M5; "Sipariş Ver" F4b'ye kadar pasif) ve sozlesme
 * onayi. Metinler icerik yedeginden.
 */

import { CONTENT_FALLBACK, PHONE_MESSAGE } from '@getir/contracts';
import type { SavedCard } from '@getir/contracts';
import type { CartTotals } from '@getir/pricing';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { EMPTY_CHECKOUT_FORM } from '../../src/features/checkout/services/checkout-rules';
import { DeliveryMethodSection } from '../../src/features/checkout/ui/DeliveryMethodSection';
import { GiftSection } from '../../src/features/checkout/ui/GiftSection';
import { OrderSummaryCard } from '../../src/features/checkout/ui/OrderSummaryCard';
import { PaymentMethodView } from '../../src/features/checkout/ui/PaymentMethodView';
import { Switch } from '../../src/shared/ui/switch/Switch';
import { TextAreaField } from '../../src/shared/ui/text-area/TextAreaField';

import { nearbyMarket } from './market-list-test-support';

const TEXTS = CONTENT_FALLBACK.checkout;
const CARD_TEXTS = CONTENT_FALLBACK.paymentMethods;
const MARKET = nearbyMarket({ id: 'mkt_a101', name: 'A101', brand: 'A101', meters: 200 }).market;

const TOTALS: CartTotals = {
  subtotalMinor: 9_460,
  discountMinor: 0,
  deliveryFeeMinor: 1_990,
  totalMinor: 11_450,
  canCheckout: true,
  amountToMinBasketMinor: 0,
  amountToFreeDeliveryMinor: 15_540,
  coupon: null,
};

const VISA: SavedCard = {
  id: `crd_${'a'.repeat(32)}`,
  brand: 'VISA',
  first4: '4242',
  last4: '1881',
  expiryMonth: 12,
  expiryYear: 2030,
  holderName: 'AYSE YILMAZ',
  nickname: 'Maaş kartım',
  expired: false,
  createdAt: '2026-10-01T10:00:00.000Z',
};

const render = (element: ReturnType<typeof createElement>) => renderToStaticMarkup(element);
/** Ekran okuyucunun okudugu sira: etiketler atilir. */
const spoken = (markup: string) => markup.replace(/<[^>]+>/g, '');

function gift(enabled: boolean, errors = {}) {
  return render(
    createElement(GiftSection, {
      gift: { ...EMPTY_CHECKOUT_FORM.gift, enabled, message: 'Merhaba' },
      errors,
      texts: TEXTS,
      onChange: () => undefined,
      onBlur: () => undefined,
    }),
  );
}

describe('Switch ve TextAreaField (T17.1)', () => {
  it('anahtar: role="switch", aria-checked, adi ve gorunen durum', () => {
    const on = render(
      createElement(Switch, {
        label: 'Hediye olarak gönder',
        checked: true,
        onChange: () => undefined,
        onText: 'Evet',
        offText: 'Hayır',
      }),
    );

    expect(on).toMatch(/role="switch" aria-checked="true" aria-label="Hediye olarak gönder"/);
    expect(on).toContain('>Evet<');
  });

  it('sayacli alan: etiket, sinir, sayac alana bagli ("7/250")', () => {
    const markup = render(
      createElement(TextAreaField, {
        id: 'not',
        label: 'Sipariş notu',
        value: 'Merhaba',
        maxLength: 250,
        onChange: () => undefined,
      }),
    );

    expect(markup).toContain('<label for="not"');
    expect(markup).toMatch(
      /<textarea id="not"[^>]*maxLength="250"[^>]*aria-describedby="([^"]+)"[\s\S]*id="\1"[^>]*>7\/250</,
    );
  });
});

describe('GiftSection (T17.1)', () => {
  it('kapali: baslik; kartin ICINDE "Hayır" anahtari (kart bos kalmaz); alan yok', () => {
    const markup = gift(false);

    expect(markup).toMatch(/<h2[^>]*>Hediye Bilgileri<\/h2>/);
    expect(markup).toMatch(/c-section-card__card[^"]*">[\s\S]*role="switch" aria-checked="false"/);
    expect(markup).not.toContain('<textarea');
    expect(markup).not.toContain('Hazır Not Ekle');
  });

  it('acik: "Hazır Not Ekle", bilgi notu (kapali), not, gonderici, zorunlu alici adi ve telefonu', () => {
    const markup = gift(true);

    expect(markup).toContain('>Hazır Not Ekle</button>');
    expect(markup).toMatch(/aria-label="Hediye bilgisi" aria-expanded="false"/);
    expect(markup).toMatch(/<p[^>]*hidden=""[^>]*>Hediye notu ve alıcı/);
    expect(markup).toContain('>7/250<');
    expect(markup).toContain('>Göndericinin Adı<');
    expect(markup).toMatch(/required=""[^>]*>[\s\S]*?\*Alıcının Adı/);
    expect(markup).toMatch(/type="tel"[\s\S]*\*Alıcının Telefon Numarası/);
    expect(markup).toMatch(
      /c-gift__fields[^"]*">(?:(?!c-gift__fields)[\s\S])*Göndericinin Adı[\s\S]*\*Alıcının Adı[\s\S]*\*Alıcının Telefon/,
    );
    expect(markup).toContain('+90');
  });

  it('hata: alan gecersiz isaretlenir ve cumle gorunur', () => {
    const markup = gift(true, { recipientPhone: PHONE_MESSAGE });

    expect(markup).toContain('aria-invalid="true"');
    expect(markup).toContain(PHONE_MESSAGE);
  });
});

describe('DeliveryMethodSection (T17.1, K4)', () => {
  const section = (totals: CartTotals) =>
    spoken(
      render(
        createElement(DeliveryMethodSection, {
          market: MARKET,
          totals,
          texts: TEXTS,
          listTexts: CONTENT_FALLBACK.marketList,
        }),
      ),
    );

  it('secili tek secenek: sure, teslimat ucreti ve minimum; "İşletme getirsin" yok', () => {
    expect(section(TOTALS)).toContain('15-25 dk · Teslimat ücreti 19,90 TL · Min. 40,00 TL');
    expect(section(TOTALS)).not.toContain('İşletme');
  });

  it('esik gecildiyse "Ücretsiz Teslimat"', () => {
    expect(section({ ...TOTALS, deliveryFeeMinor: 0 })).toContain('15-25 dk · Ücretsiz Teslimat ·');
  });
});

describe('PaymentMethodView (T17.1, M4, M7)', () => {
  const view = (card: SavedCard | undefined, loading = false) =>
    render(
      createElement(PaymentMethodView, { loading, card, texts: TEXTS, cardTexts: CARD_TEXTS }),
    );

  it('secili kart: logo, kart adi, maskeli numara; okunan ad "Visa, son dört hane 1881"', () => {
    const markup = view(VISA);

    expect(markup).toContain('>Maaş kartım<');
    expect(markup).toContain('4242 **** **** 1881');
    expect(spoken(markup)).toContain('Visa, son dört hane 1881');
  });

  it('M7: kartin yalnizca ilk 4 ve son 4 hanesi; tam numara ve CVV alani yok', () => {
    const markup = view(VISA);

    expect(markup).not.toMatch(/\d{5,}/);
    expect(markup).not.toContain('<input');
  });

  it('"Değiştir" (kart varken) ve "Kart ekle" (kart yokken) F5e kadar pasif', () => {
    expect(view(VISA)).toMatch(
      /c-payment-method__row[^"]*">[\s\S]*1881[\s\S]*aria-disabled="true">Değiştir<\/button>/,
    );
    expect(view(undefined)).toMatch(/aria-disabled="true">Kart ekle<\/button>/);
    expect(view(undefined)).toContain(TEXTS.noCardNotice);
  });

  it('kartlar okunamadi: durum gosterilir, "Kayıtlı kartın yok" ve "Kart ekle" DEGIL', () => {
    const markup = render(
      createElement(PaymentMethodView, {
        loading: false,
        problem: 'OKUNAMADI',
        card: undefined,
        texts: TEXTS,
        cardTexts: CARD_TEXTS,
      }),
    );

    expect(markup).toContain('OKUNAMADI');
    expect(markup).not.toContain(TEXTS.noCardNotice);
    expect(markup).not.toContain(TEXTS.addCardLabel);
  });

  it('kartlar yuklenirken durum; guvenlik cumlesi her durumda (Masterpass yok)', () => {
    expect(view(undefined, true)).toContain(TEXTS.cardsLoadingLabel);
    expect(view(VISA)).toContain('ödeme kayıtlı kartınla alınır');
    expect(view(VISA)).not.toMatch(/masterpass/i);
  });
});

describe('OrderSummaryCard (T17.1, M5, M6)', () => {
  const summary = (totals: CartTotals | undefined) =>
    render(
      createElement(OrderSummaryCard, {
        totals,
        agreementsAccepted: false,
        onAgreementsChange: () => undefined,
        texts: TEXTS,
      }),
    );

  it('"Sepet Tutarı", "Teslimat Ücreti", "Ödenecek Tutar"; "Kampanya" yok', () => {
    const text = spoken(summary(TOTALS));

    expect(text).toContain('Sepet Tutarı94,60 TL');
    expect(text).toContain('Teslimat Ücreti19,90 TL');
    expect(text).toContain('Ödenecek Tutar114,50 TL');
    expect(text).not.toMatch(/kampanya/i);
  });

  it('ucretsiz teslimatta "Ücretsiz"', () => {
    expect(spoken(summary({ ...TOTALS, deliveryFeeMinor: 0 }))).toContain(
      'Teslimat ÜcretiÜcretsiz',
    );
  });

  it('sozlesme onayi: kutunun adi tek cumle; iki ad pencere acan dugme', () => {
    const markup = summary(TOTALS);

    expect(markup).toContain(
      'aria-label="Ön Bilgilendirme Formu ve Mesafeli Satış Sözleşmesi&#x27;ni okudum, kabul ediyorum."',
    );
    expect(markup).toContain('>Ön Bilgilendirme Formu</button>');
    expect(markup).toContain('>Mesafeli Satış Sözleşmesi</button>');
  });

  it('"Sipariş Ver" ve tutari; siparis akisi (F4b) gelene kadar pasif', () => {
    expect(summary(TOTALS)).toMatch(
      /<button type="button"[^>]*aria-disabled="true"><span[^>]*>Sipariş Ver<\/span><span[^>]*>114,50 TL<\/span><\/button>/,
    );
  });
});
