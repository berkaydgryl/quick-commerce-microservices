/**
 * Kapida odeme arayuzu (F12; T12.4 sozlesmesi): secim modeli ve govde, pencere
 * durumu, "Kapıda Ödeme" secenekleri (reddedilince pasif), kasasiz paketin
 * penceresi, 422 sonrasi tutulan taslagin kartla yeniden kullanimi ve siparis
 * detayindaki odeme satiri.
 */

import { CONTENT_FALLBACK } from '@getir/contracts';
import type { CreateOrderRequest, Order } from '@getir/contracts';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import { heldMatchesBody } from '../../src/features/checkout/services/held-order';
import {
  methodDialogReducer,
  openMethodDialog,
  pendingChoice,
} from '../../src/features/checkout/services/method-dialog';
import {
  effectivePayment,
  paymentInput,
} from '../../src/features/checkout/services/payment-choice';
import { OnDeliveryDialog } from '../../src/features/checkout/ui/OnDeliveryDialog';
import { OnDeliveryOptions } from '../../src/features/checkout/ui/OnDeliveryOptions';
import { paymentLabel } from '../../src/features/orders/services/payment-label';
import { OrderDetailView } from '../../src/pages/account/OrderDetailView';

import { VISA_CARD } from './card-test-support';
import { ORDER } from './order-test-support';

const TEXTS = CONTENT_FALLBACK.checkout;
const ORDERS = CONTENT_FALLBACK.orders;
const CARD_ID = VISA_CARD.id;
const ORDER_ID = `ord_${'c'.repeat(32)}`;
const REFUSED = 'Bu siparişte kapıda ödeme kullanılamıyor; kartla öde.';

/** Degeri verilen radyonun acilis etiketi (oznitelik sirasindan bagimsiz). */
const radio = (html: string, value: string) =>
  new RegExp(`<input[^>]*value="${value}"[^>]*>`).exec(html)?.[0] ?? '';

describe('secim modeli ve govde', () => {
  it('kapida odeme secildiyse o; degilse uygulanan kart; ikisi de yoksa secim yok', () => {
    expect(effectivePayment('POS', CARD_ID)).toEqual({ kind: 'onDelivery', onDelivery: 'POS' });
    expect(effectivePayment(undefined, CARD_ID)).toEqual({ kind: 'card', cardId: CARD_ID });
    expect(effectivePayment(undefined, undefined)).toBeUndefined();
  });

  it('govde: kartta yalniz cardId; kapida odemede yontem ve tur, kart alani YOK (M7)', () => {
    expect(paymentInput({ kind: 'card', cardId: CARD_ID })).toEqual({
      method: 'CARD',
      cardId: CARD_ID,
    });
    expect(paymentInput({ kind: 'onDelivery', onDelivery: 'CASH' })).toEqual({
      method: 'CASH_ON_DELIVERY',
      onDelivery: 'CASH',
    });
  });

  it('engelleyici cumlesi odeme yontemi der (PM S1)', () => {
    expect(TEXTS.blockerCardNotice).toBe('Sipariş vermek için bir ödeme yöntemi seç.');
  });
});

describe('pencerenin durumu (method-dialog)', () => {
  const cards = [VISA_CARD];

  it('uygulanan kapida odemeyle acilir; kart secilince kapida odeme birakilir', () => {
    const opened = openMethodDialog(CARD_ID, 'list', 'CASH');
    expect(pendingChoice(opened, cards)).toEqual({ kind: 'onDelivery', onDelivery: 'CASH' });

    const picked = methodDialogReducer(opened, { type: 'pick', cardId: CARD_ID });
    expect(pendingChoice(picked, cards)).toEqual({ kind: 'card', cardId: CARD_ID });
  });

  it('kapida odeme secimi kart secimini gecersiz kilar', () => {
    const state = methodDialogReducer(openMethodDialog(CARD_ID, 'list'), {
      type: 'pickOnDelivery',
      onDelivery: 'POS',
    });

    expect(pendingChoice(state, cards)).toEqual({ kind: 'onDelivery', onDelivery: 'POS' });
  });
});

describe('"Kapıda Ödeme" secenekleri', () => {
  const options = (refusedNotice?: string) =>
    renderToStaticMarkup(
      createElement(OnDeliveryOptions, {
        name: 'odeme',
        selected: 'CASH',
        refusedNotice,
        texts: TEXTS,
        onPick: () => undefined,
      }),
    );

  it('baslik ve iki radyo ayni adla; secili tur isaretli', () => {
    const html = options();

    expect(html).toMatch(/<legend[^>]*>Kapıda Ödeme<\/legend>/);
    expect(radio(html, 'CASH')).toContain('checked=""');
    expect(radio(html, 'CASH')).toContain('name="odeme"');
    expect(radio(html, 'POS')).toContain('name="odeme"');
    expect(radio(html, 'POS')).not.toContain('checked');
    expect(html).not.toContain('disabled');
  });

  it('reddedildi (422): grup pasif, sunucunun cumlesi gorunur ve gruba bagli', () => {
    const html = options(REFUSED);
    const notice = new RegExp(`<p id="([^"]+)"[^>]*>${REFUSED}</p>`).exec(html);

    expect(notice).not.toBeNull();
    expect(html).toMatch(
      new RegExp(`<fieldset[^>]*disabled=""[^>]*aria-describedby="${notice?.[1]}"`),
    );
  });
});

describe('kasasiz paketin penceresi', () => {
  const dialog = (applied?: 'CASH' | 'POS', refusedNotice?: string) =>
    renderToStaticMarkup(
      createElement(OnDeliveryDialog, {
        applied,
        refusedNotice,
        texts: TEXTS,
        onChoose: () => undefined,
        onClose: () => undefined,
      }),
    );

  it('baslik "Ödeme Yöntemi Seç", yalniz kapida odeme; secim yokken "Seç" pasif', () => {
    const html = dialog();

    expect(html).toContain(TEXTS.methodDialogTitle);
    expect(html).toContain('Kapıda Ödeme');
    expect(html).not.toContain(TEXTS.onlinePaymentTitle);
    expect(html).toMatch(/<button type="button"[^>]*disabled=""[^>]*>Seç<\/button>/);
  });

  it('uygulanan tur secili acilir ve "Seç" etkin; reddedildiyse secili gelmez', () => {
    expect(radio(dialog('POS'), 'POS')).toContain('checked=""');
    expect(dialog('POS')).not.toMatch(/disabled=""[^>]*>Seç</);
    expect(dialog('POS', REFUSED)).not.toContain('checked=""');
  });
});

describe('422 sonrasi tutulan taslak', () => {
  it('parmak izi olmadan tutulur: ayni siparis kartla verilebilir', () => {
    const held = {
      orderId: ORDER_ID,
      fingerprint: '{}',
      reservationReceivedAt: 1_000,
      reservationTtlSeconds: 600,
    };
    const cardBody: CreateOrderRequest = {
      orderId: ORDER_ID,
      payment: { method: 'CARD', cardId: CARD_ID },
      details: { note: '', doNotRingBell: false, agreementsAccepted: true },
    };

    expect(heldMatchesBody(held, cardBody)).toBe(true);
  });
});

describe('siparis detayinda odeme satiri', () => {
  it('kart, kapida nakit, kapida POS; eski sipariste yok', () => {
    expect(paymentLabel({ method: 'CARD' }, ORDERS)).toBe('Kart');
    expect(paymentLabel({ method: 'CASH_ON_DELIVERY', onDelivery: 'CASH' }, ORDERS)).toBe(
      'Kapıda nakit',
    );
    expect(paymentLabel({ method: 'CASH_ON_DELIVERY', onDelivery: 'POS' }, ORDERS)).toBe(
      'Kapıda kredi/banka kartı',
    );
    expect(paymentLabel(undefined, ORDERS)).toBeUndefined();
  });

  const detail = (order: Order) =>
    renderToStaticMarkup(
      createElement(
        MemoryRouter,
        null,
        createElement(OrderDetailView, {
          texts: ORDERS,
          order,
          marketName: 'A101',
          error: null,
          onRetry: () => undefined,
          listHref: '/hesabim/siparislerim',
        }),
      ),
    );

  it('detayda "Ödeme: Kapıda nakit"; payment yoksa satir yok', () => {
    expect(
      detail({ ...ORDER, payment: { method: 'CASH_ON_DELIVERY', onDelivery: 'CASH' } }),
    ).toMatch(/<dt>Ödeme<\/dt><dd>Kapıda nakit<\/dd>/);
    expect(detail(ORDER)).not.toContain('<dt>Ödeme</dt>');
  });
});
