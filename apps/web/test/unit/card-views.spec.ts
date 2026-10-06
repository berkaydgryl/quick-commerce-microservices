/**
 * Kart gorunumleri (T11.17, tasarim B; M3): kart gorseli (markanin katmani,
 * rozet, cerceve, donme) ve Odeme Yontemlerim listesi
 * (referans getircarsi: logo, kart adi ya da marka, maskeli numara, suresi
 * gecen etiketi, cop kutusu; son satir "+ Kredi/Banka Kartı" ya da dolu
 * kasanin cumlesi). Metinler icerik yedeginden. Form: add-card-form.spec.ts.
 */

import { CARD_FIELD_MESSAGES, CONTENT_FALLBACK, SAVED_CARDS_MAX } from '@getir/contracts';
import type { SavedCard } from '@getir/contracts';
import { createElement } from 'react';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import { savedCardFace, typedCardFace } from '../../src/features/cards/services/card-face';
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
      onDelete: noop,
      ...props,
    }),
  );
const rows = (html: string) => html.split('<li').slice(1);

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
});

describe('PaymentMethodsView (T11.17, referans getircarsi)', () => {
  it('satir: marka logosu, kart adi, maskeli numara; cop kutusunun adi karttan', () => {
    const [visa, amex] = rows(view({}));

    expect(visa).toContain('c-brand-logo');
    expect(visa).toContain(`>${VISA_CARD.nickname ?? ''}<`);
    expect(visa).toContain('>4242 **** **** 4242<');
    expect(visa).toContain(`aria-label="Visa, son dört hane 4242 ${TEXTS.deleteSuffix}"`);
    expect(amex).toContain('>3782 ****** *0005<');
    expect(amex).toContain(`aria-label="Amex, son dört hane 0005 ${TEXTS.deleteSuffix}"`);
  });

  it('QA D6: ekran okuyucu kart adi + marka + son dort haneyi okur; gorunen ad ve maske gizli', () => {
    const [visa, amex] = rows(view({}));
    const spoken = (row = '') => /__spoken[^>]*>([^<]+)</.exec(row)?.[1];

    expect(spoken(visa)).toBe(`${VISA_CARD.nickname ?? ''}, Visa, ${TEXTS.lastFourLabel} 4242`);
    expect(spoken(amex)).toBe(`Amex, ${TEXTS.lastFourLabel} 0005`);
    expect(visa).toMatch(/__name[^"]*" aria-hidden="true"/);
    expect(visa).toMatch(/__number[^"]*" aria-hidden="true"/);
  });

  it('kart adi yoksa markanin adi', () => {
    const [amex] = rows(view({ cards: [EXPIRED_AMEX] }));

    expect(EXPIRED_AMEX.nickname).toBeUndefined();
    expect(amex).toContain(`>${TEXTS.brandLabels.AMEX}<`);
  });

  it('suresi gecen kart: etiket ve soluk satir; digerinde etiket yok', () => {
    const [visa, amex] = rows(view({}));

    expect(amex).toContain(TEXTS.expiredLabel);
    expect(amex).toContain('is-expired');
    expect(visa).not.toContain(TEXTS.expiredLabel);
  });

  it('son satir "+ Kredi/Banka Kartı" baglantisi; karti olmayan hesapta yalnizca bu satir', () => {
    const last = rows(view({})).at(-1) ?? '';
    expect(last).toMatch(
      new RegExp(`<a[^>]*href="/hesabim/odeme-yontemlerim/ekle"[^>]*>.*${TEXTS.addLabel}</a>`, 's'),
    );

    const empty = rows(view({ cards: [] as SavedCard[] }));
    expect(empty).toHaveLength(1);
    expect(empty[0]).toContain(TEXTS.addLabel);
  });

  it('kasa dolu (10 kart): ekleme satiri yerine sozlesmenin cumlesi', () => {
    const full = Array.from({ length: SAVED_CARDS_MAX }, (_, index) => ({
      ...VISA_CARD,
      id: `crd_${String(index).padStart(32, '0')}`,
    }));
    const html = view({ cards: full });

    expect(html).not.toContain('/hesabim/odeme-yontemlerim/ekle');
    expect(rows(html).at(-1)).toContain(CARD_FIELD_MESSAGES.cards);
  });

  it('yuklenirken not; hata gelince tekrar dene', () => {
    expect(view({ cards: undefined })).toContain(TEXTS.loadingLabel);
    const failed = view({ cards: undefined, error: new Error('ag') });
    expect(failed).not.toContain(TEXTS.loadingLabel);
    expect(failed).toContain('<button');
  });
});
