/**
 * Siparis detayi gorunumu (T11.16): listeye donus, market adi ve durum,
 * tarih ve adres, urunler, tutar dokumu (ucretsiz teslimat, indirim). Iptal
 * edilen sipariste her urunde "Teslim edilmedi" (#91); iade notu. Metinler
 * icerik yedeginden.
 */

import { CONTENT_FALLBACK } from '@getir/contracts';
import type { Order } from '@getir/contracts';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import { OrderDetailView } from '../../src/pages/account/OrderDetailView';
import type { OrderDetailViewProps } from '../../src/pages/account/OrderDetailView';
import { formatDateTime } from '../../src/shared/services/format';

import { ORDER } from './order-test-support';

const TEXTS = CONTENT_FALLBACK.orders;
const noop = () => undefined;

const view = (props: Partial<OrderDetailViewProps>) =>
  renderToStaticMarkup(
    createElement(
      MemoryRouter,
      null,
      createElement(OrderDetailView, {
        texts: TEXTS,
        order: ORDER,
        marketName: 'Moda Kasabı',
        error: null,
        onRetry: noop,
        listHref: '/hesabim/siparislerim',
        ...props,
      }),
    ),
  );

const text = (html: string) => html.replace(/<[^>]+>/g, '');
const cancelled: Order = {
  ...ORDER,
  status: 'CANCELLED',
  timeline: [
    { status: 'DRAFT', at: '2026-10-05T11:58:00.000Z' },
    { status: 'PAID', at: '2026-10-05T12:00:00.000Z' },
    { status: 'CANCELLED', at: '2026-10-05T12:05:00.000Z' },
  ],
};

describe('OrderDetailView (T11.16)', () => {
  it('listeye donus, baslikta market adi, durum', () => {
    const html = view({});

    expect(html).toMatch(/<a[^>]*href="\/hesabim\/siparislerim"[^>]*>.*Geçmiş Siparişlerim<\/a>/s);
    expect(html).toMatch(/<h1[^>]*>Moda Kasabı<\/h1>/);
    expect(html).toMatch(/c-order-status--completed[^>]*>Tamamlandı</);
  });

  it('market adi gelmediyse genel ad', () => {
    expect(view({ marketName: undefined })).toMatch(/<h1[^>]*>Market<\/h1>/);
  });

  it('tarih ve teslimat adresi', () => {
    const plain = text(view({}));

    expect(plain).toContain(`Sipariş tarihi${formatDateTime(ORDER.createdAt)}`);
    expect(plain).toContain(`Teslimat adresi${ORDER.address.line}`);
  });

  it('urunler: adet, ad, satir tutari; teslim edilen sipariste "Teslim edilmedi" yok', () => {
    const plain = text(view({}));

    expect(plain).toContain('2×Dana Kıyma 500 g400,00 TL');
    expect(plain).toContain('1×Süt 1 L50,00 TL');
    expect(plain).not.toContain(TEXTS.notDeliveredLabel);
  });

  it('iptal edilen sipariste her urunde "Teslim edilmedi" (#91) ve iade notu', () => {
    const html = view({ order: cancelled });

    expect(html.split(TEXTS.notDeliveredLabel)).toHaveLength(ORDER.lines.length + 1);
    expect(text(html)).toContain('İptal edildi · Ücret iade edildi');
  });

  it('tutar dokumu: ara toplam, teslimat, toplam; indirim yoksa satiri yok', () => {
    const plain = text(view({}));

    expect(plain).toContain('Ara toplam450,00 TL');
    expect(plain).toContain('Teslimat50,00 TL');
    expect(plain).toContain('Toplam500,00 TL');
    expect(plain).not.toContain(TEXTS.discountLabel);
  });

  it('ucretsiz teslimat ve indirim', () => {
    const plain = text(
      view({
        order: {
          ...ORDER,
          deliveryFee: { amountMinor: 0, currency: 'TRY' },
          discount: { amountMinor: 2_500, currency: 'TRY' },
          total: { amountMinor: 42_500, currency: 'TRY' },
        },
      }),
    );

    expect(plain).toContain('TeslimatÜcretsiz');
    expect(plain).toContain('İndirim−25,00 TL');
    expect(plain).toContain('Toplam425,00 TL');
  });

  it('siparis yuklenirken not; hata gelince tekrar dene; donus baglantisi her durumda', () => {
    const loading = view({ order: undefined });
    expect(loading).toContain(TEXTS.loadingLabel);
    expect(loading).toContain('href="/hesabim/siparislerim"');

    const failed = view({ order: undefined, error: new Error('bulunamadi') });
    expect(failed).not.toContain(TEXTS.loadingLabel);
    expect(failed).toContain('<button');
    expect(failed).not.toContain('<h1');
  });
});
