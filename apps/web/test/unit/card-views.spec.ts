/**
 * Kart gorunumleri (T11.17, tasarim B; M3, M4): kart gorseli (markanin
 * katmani, rozet, cerceve, donme; kucukte arka yuz yok), kayitli kartlar
 * (kisa ad, cop kutusu, suresi gecen, bos, "Kart ekle") ve form (ilk hal).
 * Metinler icerik yedeginden.
 */

import { CARD_FIELD_MESSAGES, CONTENT_FALLBACK, SAVED_CARDS_MAX } from '@getir/contracts';
import type { SavedCard } from '@getir/contracts';
import { createElement } from 'react';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import { savedCardFace, typedCardFace } from '../../src/features/cards/services/card-face';
import { AddCardForm } from '../../src/features/cards/ui/AddCardForm';
import { CardVisual } from '../../src/features/cards/ui/CardVisual';
import type { CardVisualProps } from '../../src/features/cards/ui/CardVisual';
import { PaymentMethodsView } from '../../src/pages/account/PaymentMethodsView';
import type { PaymentMethodsViewProps } from '../../src/pages/account/PaymentMethodsView';

import { EXPIRED_AMEX, VISA_CARD } from './card-test-support';

const TEXTS = CONTENT_FALLBACK.paymentMethods;
const noop = () => undefined;
const render = (element: ReactElement) =>
  renderToStaticMarkup(createElement(MemoryRouter, null, element));

const visual = (props: Partial<CardVisualProps>) =>
  renderToStaticMarkup(
    createElement(CardVisual, {
      brand: 'VISA',
      groups: savedCardFace(VISA_CARD),
      holderName: 'AYŞE YILMAZ',
      expiry: '08/29',
      nickname: 'Maaş kartım',
      cvvMask: '•••',
      texts: TEXTS,
      size: 'large',
      ...props,
    }),
  );

/** Gorunur (is-active) katmanin marka niteleyicisi. */
const activeLayer = (html: string) =>
  /c-payment-card__layer--([a-z]+)[^"]*is-active/.exec(html)?.[1] ?? null;

const view = (props: Partial<PaymentMethodsViewProps>) =>
  render(
    createElement(PaymentMethodsView, {
      texts: TEXTS,
      cards: [VISA_CARD, EXPIRED_AMEX],
      error: null,
      onRetry: noop,
      addHref: '/hesabim/odeme-yontemlerim/ekle',
      actionsDisabled: false,
      onDelete: noop,
      ...props,
    }),
  );
const tiles = (html: string) => html.split('<li').slice(1);

describe('CardVisual (T11.17)', () => {
  it('markanin katmani gorunur, digerleri saydam; marka yoksa varsayilan mor', () => {
    expect(activeLayer(visual({ brand: 'VISA' }))).toBe('visa');
    expect(activeLayer(visual({ brand: 'MASTERCARD' }))).toBe('mastercard');
    expect(activeLayer(visual({ brand: 'AMEX' }))).toBe('amex');
    expect(activeLayer(visual({ brand: 'TROY' }))).toBe('troy');
    expect(activeLayer(visual({ brand: null }))).toBe('default');
    expect(visual({ brand: null })).not.toContain('c-payment-card__badge');
  });

  it('suslemedir (aria-hidden); numara yuzde maskeli', () => {
    const html = visual({ groups: typedCardFace('4111111111111234', 'VISA') });

    expect(html).toMatch(/^<div[^>]*aria-hidden="true"/);
    expect(html.replace(/<[^>]+>/g, '')).toContain('4111••••••••1234');
  });

  it('CVV alaninda doner; odaktaki alanin cercevesi gorunur', () => {
    expect(visual({ flipped: true })).toMatch(/c-payment-card[^"]*is-flipped/);
    expect(visual({ flipped: false })).not.toContain('is-flipped');
    expect(visual({ focus: 'expiry' })).toMatch(/c-payment-card__frame--expiry[^"]*is-visible/);
    expect(visual({ focus: null })).not.toContain('is-visible');
  });

  it('kucuk kart (liste): arka yuz, isik, cerceve ve parlama yok', () => {
    const html = visual({ size: 'small' });

    expect(html).toContain('c-payment-card--small');
    expect(html).not.toContain('c-payment-card__face--back');
    expect(html).not.toContain('c-payment-card__streak');
    expect(html).not.toContain('c-payment-card__frame');
    expect(html).not.toContain('c-payment-card__glare');
  });
});

describe('PaymentMethodsView (T11.17, M4)', () => {
  it('kartlar kisa adiyla; cop kutusunun adi karttan', () => {
    const [visa, amex] = tiles(view({}));

    expect(visa).toContain('>Visa •••• 4242<');
    expect(visa).toContain(`aria-label="Visa •••• 4242 ${TEXTS.deleteSuffix}"`);
    expect(amex).toContain(`aria-label="Amex •••• 0005 ${TEXTS.deleteSuffix}"`);
  });

  it('suresi gecen kart: rozet ve soluk gorsel; digerinde rozet yok', () => {
    const [visa, amex] = tiles(view({}));

    expect(amex).toContain(TEXTS.expiredLabel);
    expect(amex).toContain('is-expired');
    expect(visa).not.toContain(TEXTS.expiredLabel);
  });

  it('sonda "Kart ekle" baglantisi; karti olmayan hesapta bos not', () => {
    const html = view({});
    const last = tiles(html).at(-1) ?? '';
    expect(last).toMatch(/<a[^>]*href="\/hesabim\/odeme-yontemlerim\/ekle"[^>]*>.*Kart ekle<\/a>/s);

    const empty = view({ cards: [] as SavedCard[] });
    expect(empty).toContain(TEXTS.emptyNotice);
    expect(tiles(empty)).toHaveLength(1);
  });

  it('pencere metinleri yuklenmediyse cop kutulari bekler (pasif)', () => {
    const buttons = view({ actionsDisabled: true }).match(/<button[^>]*disabled=""/g) ?? [];

    expect(buttons).toHaveLength(2);
  });

  it('kasa dolu (10 kart): "Kart ekle" yerine sozlesmenin cumlesi', () => {
    const full = Array.from({ length: SAVED_CARDS_MAX }, (_, index) => ({
      ...VISA_CARD,
      id: `crd_${String(index).padStart(32, '0')}`,
    }));
    const html = view({ cards: full });

    expect(html).not.toContain('/hesabim/odeme-yontemlerim/ekle');
    expect(html).toContain(CARD_FIELD_MESSAGES.cards);
  });

  it('yuklenirken not; hata gelince tekrar dene', () => {
    expect(view({ cards: undefined })).toContain(TEXTS.loadingLabel);
    const failed = view({ cards: undefined, error: new Error('ag') });
    expect(failed).not.toContain(TEXTS.loadingLabel);
    expect(failed).toContain('<button');
  });
});

describe('AddCardForm (T11.17, M5)', () => {
  const form = () =>
    render(
      createElement(AddCardForm, {
        texts: TEXTS,
        onSave: () => Promise.resolve(VISA_CARD),
        onSaved: noop,
      }),
    );

  it('baslik, desteklenen markalar, buyuk kart (varsayilan renk, yer tutucular)', () => {
    const html = form();

    expect(html).toMatch(/<h1[^>]*>Kart ekle<\/h1>/);
    expect(html).toContain(`aria-label="${TEXTS.brandsLabel}"`);
    for (const label of Object.values(TEXTS.brandLabels)) {
      expect(html).toContain(`>${label}</li>`);
    }
    expect(html).toContain('c-payment-card--large');
    expect(activeLayer(html)).toBe('default');
    expect(html).toContain(TEXTS.holderPlaceholder);
    expect(html).toContain(TEXTS.nicknamePlaceholder);
  });

  it('bes alan yuzen etiketle, kart otomatik doldurma adlariyla; kaydet ve gizlilik notu', () => {
    const html = form();

    for (const [id, label, autocomplete] of [
      ['kart-numara', TEXTS.numberLabel, 'cc-number'],
      ['kart-ad', TEXTS.holderNameLabel, 'cc-name'],
      ['kart-skt', TEXTS.expiryLabel, 'cc-exp'],
      ['kart-cvv', TEXTS.cvvLabel, 'cc-csc'],
      ['kart-takma-ad', TEXTS.nicknameLabel, 'off'],
    ] as const) {
      expect(html).toMatch(new RegExp(`<input[^>]*id="${id}"[^>]*autoComplete="${autocomplete}"`));
      expect(html).toContain(`<label for="${id}"`);
      expect(html).toContain(`>${label}</label>`);
    }
    expect(html).toContain('c-auth-field--floating');
    expect(html).toMatch(/<button type="submit"[^>]*>Kartı kaydet<\/button>/);
    expect(html).toContain(TEXTS.privacyNote.replace(/'/g, '&#x27;'));
    expect(html).not.toContain(TEXTS.numberValidLabel);
  });
});
