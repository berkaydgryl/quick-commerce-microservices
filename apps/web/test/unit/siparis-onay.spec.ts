/**
 * Siparis onay ekrani (F17; PM S1-S4 a): /siparis/:id/onay. Baslik durumdan
 * (verildi / incelemede / onay degil); takip cizgisi basligin hemen altinda;
 * ozet (market, tarih, tahmini varis, adres, odeme), teslimat ayrintilari
 * (varsa), urunler, tutarlar; iki dugme. Odeme satiri kart listesinden (S4):
 * kart yoksa yalniz "Kart". Gezinme durumunda yalniz sonucun turu ve kartin
 * kimligi; ekran bir kez gosterildiyse yoklamada durum degisse de kalir.
 */

import { CONTENT_FALLBACK } from '@getir/contracts';
import type { Order, OrderStatus } from '@getir/contracts';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import { orderConfirmationPath } from '../../src/features/orders/routes';
import {
  confirmationFromState,
  confirmationHeading,
  confirmationKind,
  confirmationPayment,
  confirmationState,
  deliveryDetailRows,
  showsEstimate,
} from '../../src/features/orders/services/order-confirmation';
import { OrderConfirmationView } from '../../src/pages/order-confirmation/OrderConfirmationView';
import type { OrderConfirmationViewProps } from '../../src/pages/order-confirmation/OrderConfirmationView';

import { EXPIRED_AMEX, VISA_CARD } from './card-test-support';
import { ORDER, ORDER_ID } from './order-test-support';

const TEXTS = CONTENT_FALLBACK.orderConfirmation;
const ORDER_TEXTS = CONTENT_FALLBACK.orders;
const CHECKOUT = CONTENT_FALLBACK.checkout;
const BRANDS = CONTENT_FALLBACK.paymentMethods.brandLabels;
const DETAILS = {
  note: '',
  doNotRingBell: false,
  agreementsAccepted: true,
  agreementsAcceptedAt: '2026-10-05T12:00:00.000Z',
};
const STATUSES: readonly OrderStatus[] = [
  'DRAFT',
  'RISK_CHECK',
  'REVIEW',
  'RESERVED',
  'AWAITING_PAYMENT',
  'PAID',
  'PREPARING',
  'ON_THE_WAY',
  'DELIVERED',
  'CANCELLED',
  'REJECTED',
  'PAYMENT_FAILED',
  'EXPIRED',
];

describe('baslik ve tahmin (durumdan)', () => {
  it('verildi: odendi, hazirlaniyor, yolda, teslim; inceleme ayri; digerleri onay degil', () => {
    const kinds = Object.fromEntries(STATUSES.map((status) => [status, confirmationKind(status)]));

    expect(kinds).toEqual({
      DRAFT: 'other',
      RISK_CHECK: 'other',
      REVIEW: 'review',
      RESERVED: 'other',
      AWAITING_PAYMENT: 'other',
      PAID: 'placed',
      PREPARING: 'placed',
      ON_THE_WAY: 'placed',
      DELIVERED: 'placed',
      CANCELLED: 'other',
      REJECTED: 'other',
      PAYMENT_FAILED: 'other',
      EXPIRED: 'other',
    });
  });

  it('tahmini varis yalniz siparis yoldayken (teslimde ve incelemede yok)', () => {
    expect(STATUSES.filter(showsEstimate)).toEqual(['PAID', 'PREPARING', 'ON_THE_WAY']);
  });
});

describe('gezinme durumu ve baslik', () => {
  it('gezinme durumunda yalniz sonucun turu ve (kartla odendiyse) kartin kimligi', () => {
    expect(confirmationState('placed', VISA_CARD.id)).toEqual({
      heading: 'placed',
      cardId: VISA_CARD.id,
    });
    expect(confirmationState('review', undefined)).toEqual({ heading: 'review' });
    expect(confirmationFromState({ heading: 'review', cardId: VISA_CARD.id })).toEqual({
      heading: 'review',
      cardId: VISA_CARD.id,
    });
  });

  it('bicimi tutmayan durum (eski kayit, dogrudan adres, sahte kart) bos sayilir', () => {
    for (const state of [
      null,
      undefined,
      {},
      'crd_x',
      { cardId: VISA_CARD.id },
      { heading: 'other' },
      { heading: 'placed', cardId: '4242' },
    ]) {
      expect(confirmationFromState(state)).toEqual({});
    }
  });

  it('ekran bir kez gosterildiyse onay olmayan duruma gecen siparis ekrandan atilmaz', () => {
    expect(confirmationHeading(undefined, undefined)).toBeUndefined();
    expect(confirmationHeading(undefined, 'placed')).toBe('placed');
    expect(confirmationHeading('PAID', undefined)).toBe('placed');
    expect(confirmationHeading('REVIEW', 'placed')).toBe('review');
    expect(confirmationHeading('RESERVED', 'review')).toBe('review');
    expect(confirmationHeading('REJECTED', 'review')).toBe('review');
    expect(confirmationHeading('CANCELLED', undefined)).toBe('leave');
  });
});

describe('odeme satiri (S4 a)', () => {
  it('kart listede varsa "Visa •••• 4242"; kimlik yok, kart silinmis ya da liste gelmediyse "Kart"', () => {
    const payment = { method: 'CARD' as const };
    const line = (cardId: string | undefined, cards = [VISA_CARD, EXPIRED_AMEX]) =>
      confirmationPayment({ payment, cardId, cards, texts: ORDER_TEXTS, brandLabels: BRANDS });

    expect(line(VISA_CARD.id)).toBe('Visa •••• 4242');
    expect(line(EXPIRED_AMEX.id)).toBe('Amex •••• 0005');
    expect(line(undefined)).toBe('Kart');
    expect(line(VISA_CARD.id, [EXPIRED_AMEX])).toBe('Kart');
    expect(
      confirmationPayment({
        payment,
        cardId: VISA_CARD.id,
        cards: undefined,
        texts: ORDER_TEXTS,
        brandLabels: BRANDS,
      }),
    ).toBe('Kart');
  });

  it('kapida odeme ve eski siparis siparis detayiyla ayni', () => {
    const line = (payment: Order['payment']) =>
      confirmationPayment({
        payment,
        cardId: VISA_CARD.id,
        cards: [VISA_CARD],
        texts: ORDER_TEXTS,
        brandLabels: BRANDS,
      });

    expect(line({ method: 'CASH_ON_DELIVERY', onDelivery: 'CASH' })).toBe('Kapıda nakit');
    expect(line({ method: 'CASH_ON_DELIVERY', onDelivery: 'POS' })).toBe(
      'Kapıda kredi/banka kartı',
    );
    expect(line(undefined)).toBeUndefined();
  });

  it('onay ekraninin adresinde yalniz siparis kimligi (kodlanir)', () => {
    expect(orderConfirmationPath(ORDER_ID)).toBe(`/siparis/${ORDER_ID}/onay`);
    expect(orderConfirmationPath('a/b')).toBe('/siparis/a%2Fb/onay');
  });
});

describe('teslimat ayrintilari (S3 a)', () => {
  const gift = {
    message: 'İyi ki doğdun!',
    senderName: 'Ayşe',
    recipientName: 'Mehmet Kaya',
    recipientPhone: '+905551112233',
  };

  it('hediyede alici, kart notu ve gonderen; bos olan yok; alicinin telefonu YAZILMAZ', () => {
    const rows = deliveryDetailRows({ ...DETAILS, gift: { ...gift, message: ' ' } }, CHECKOUT);

    expect(rows).toEqual([
      { label: 'Alıcının Adı', value: 'Mehmet Kaya' },
      { label: 'Göndericinin Adı', value: 'Ayşe' },
    ]);
    expect(JSON.stringify(rows)).not.toContain(gift.recipientPhone);
  });

  it('siparis notu satiri; bos not ve ayrintisiz sipariste satir yok', () => {
    expect(deliveryDetailRows({ ...DETAILS, note: 'Kapıya bırakın' }, CHECKOUT)).toEqual([
      { label: 'Sipariş notu', value: 'Kapıya bırakın' },
    ]);
    expect(deliveryDetailRows({ ...DETAILS, note: '  ' }, CHECKOUT)).toEqual([]);
    expect(deliveryDetailRows(undefined, CHECKOUT)).toEqual([]);
  });
});

const view = (props: Partial<OrderConfirmationViewProps>) =>
  renderToStaticMarkup(
    createElement(
      MemoryRouter,
      null,
      createElement(OrderConfirmationView, {
        texts: TEXTS,
        heading: 'placed',
        orderTexts: ORDER_TEXTS,
        detailTexts: CHECKOUT,
        order: { ...ORDER, status: 'PAID' },
        error: null,
        onRetry: () => undefined,
        marketName: 'Moda Kasabı',
        estimate: { label: 'Tahmini varış süresi', value: '20-30 dk' },
        payment: 'Visa •••• 4242',
        ordersHref: '/hesabim/siparislerim',
        continueHref: '/markets',
        ...props,
      }),
    ),
  );

const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

describe('OrderConfirmationView', () => {
  it('verilen sipariste "Siparişin alındı!" (h1), not yok; takip cizgisi basligin HEMEN altinda', () => {
    for (const status of ['PAID', 'PREPARING', 'ON_THE_WAY'] as const) {
      const html = view({ order: { ...ORDER, status } });

      expect(html).toMatch(/<h1[^>]*>Siparişin alındı!<\/h1>/);
      expect(html).not.toContain(TEXTS.reviewNotice);
      const order = [
        html.indexOf('Siparişin alındı!'),
        html.indexOf(ORDER_TEXTS.trackTitle),
        html.indexOf(TEXTS.summaryTitle),
        html.indexOf(ORDER_TEXTS.itemsTitle),
        html.indexOf(ORDER_TEXTS.totalLabel),
        html.indexOf(TEXTS.ordersLinkLabel),
      ];
      expect(order.every((at) => at >= 0)).toBe(true);
      expect([...order].sort((a, b) => a - b)).toEqual(order);
    }
  });

  it('incelemede "Siparişin inceleniyor" ve not; cizgi yok (inceleme bitince gelir)', () => {
    const html = view({ heading: 'review', order: { ...ORDER, status: 'REVIEW' } });

    expect(html).toMatch(/<h1[^>]*>Siparişin inceleniyor<\/h1>/);
    expect(html).toContain(TEXTS.reviewNotice);
    expect(html).not.toContain(ORDER_TEXTS.trackTitle);
    expect(html).not.toContain('Siparişin alındı!');
  });

  it('ozet: market, tarih, tahmini varis, adres, odeme; tahmin ve odeme yoksa satirlari yok', () => {
    const full = text(view({}));

    expect(full).toContain('Moda Kasabı');
    expect(full).toContain('Tahmini varış süresi 20-30 dk');
    expect(full).toContain(`${ORDER_TEXTS.addressLabel} ${ORDER.address.line}`);
    expect(full).toContain(`${ORDER_TEXTS.paymentLabel} Visa •••• 4242`);
    const bare = text(view({ estimate: undefined, payment: undefined }));
    expect(bare).not.toContain('Tahmini varış süresi');
    expect(bare).not.toContain(ORDER_TEXTS.paymentLabel);
  });

  it('teslimat ayrintilari karti yalniz ayrinti varsa; "Zili Çalma" tek basina da karti acar', () => {
    expect(view({})).not.toContain(TEXTS.detailsTitle);
    expect(
      text(
        view({ order: { ...ORDER, status: 'PAID', details: { ...DETAILS, doNotRingBell: true } } }),
      ),
    ).toContain(`${TEXTS.detailsTitle} ${CHECKOUT.doNotRingLabel}`);
    const html = text(
      view({
        order: {
          ...ORDER,
          status: 'PAID',
          details: { ...DETAILS, note: 'Kapıya bırakın', doNotRingBell: true },
        },
      }),
    );
    expect(html).toContain(
      `${TEXTS.detailsTitle} ${CHECKOUT.noteLabel} Kapıya bırakın ${CHECKOUT.doNotRingLabel}`,
    );
  });

  it('dugmeler: "Siparişlerime git" Gecmis Siparislerim, "Alışverişe devam et" market listesi', () => {
    const html = view({});

    expect(html).toMatch(/<a[^>]*href="\/hesabim\/siparislerim"[^>]*>Siparişlerime git<\/a>/);
    expect(html).toMatch(/<a[^>]*href="\/markets"[^>]*>Alışverişe devam et<\/a>/);
  });

  it('akistan gelen baslik siparis okunamasa da gorunur; baslik bilinmiyorsa yalniz yukleniyor', () => {
    const failed = view({ order: undefined, error: new Error('x') });
    expect(failed).toMatch(/<h1[^>]*>Siparişin alındı!<\/h1>/);
    expect(failed).not.toContain(ORDER_TEXTS.loadingLabel);
    const loading = view({ heading: undefined, order: undefined });
    expect(loading).toContain(ORDER_TEXTS.loadingLabel);
    expect(loading).not.toContain('<h1');
  });

  it('siparis sonradan onay olmayan duruma gecerse baslik kalir, durum etiketi gercegi soyler, not kalkar', () => {
    const html = text(view({ heading: 'review', order: { ...ORDER, status: 'REJECTED' } }));

    expect(html).toContain('Siparişin inceleniyor');
    expect(html).toContain(ORDER_TEXTS.cancelledLabel);
    expect(html).not.toContain(TEXTS.reviewNotice);
  });

  it('market adi yuklenirken genel ad ("Market") yazilmaz', () => {
    expect(text(view({ marketName: undefined }))).not.toContain(
      ` ${ORDER_TEXTS.unknownMarketLabel} `,
    );
  });
});
