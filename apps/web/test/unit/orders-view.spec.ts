/**
 * Gecmis Siparislerim gorunumu (T11.16): satir "Market · 500,00 TL ·
 * Tamamlandı", altinda tarih, sagda ok, detay baglantisi; durum gruplari
 * (Devam ediyor sari rozet, iptal gri, iade notu); bos, yukleniyor, hata ve
 * "Daha fazla göster". Metinler icerik yedeginden.
 */

import { CONTENT_FALLBACK } from '@getir/contracts';
import type { OrderSummary } from '@getir/contracts';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import { formatDateTime } from '../../src/shared/services/format';
import { OrdersView } from '../../src/pages/account/OrdersView';
import type { OrdersViewProps } from '../../src/pages/account/OrdersView';

import { ORDER_ID, SUMMARY } from './order-test-support';

const TEXTS = CONTENT_FALLBACK.orders;
const noop = () => undefined;

const view = (props: Partial<OrdersViewProps>) =>
  renderToStaticMarkup(
    createElement(
      MemoryRouter,
      null,
      createElement(OrdersView, {
        texts: TEXTS,
        orders: [SUMMARY],
        error: null,
        onRetry: noop,
        hasMore: false,
        loadingMore: false,
        moreError: null,
        onMore: noop,
        ...props,
      }),
    ),
  );

/** Satirlarin HTML'i, sirayla. */
const rows = (html: string) => html.split('<li').slice(1);
/** Etiketsiz metin. */
const text = (html: string) => html.replace(/<[^>]+>/g, '');

const order = (overrides: Partial<OrderSummary>): OrderSummary => ({ ...SUMMARY, ...overrides });

describe('OrdersView (T11.16)', () => {
  it('satir: "Market · 500,00 TL · Tamamlandı", altinda tarih; detay baglantisi ve ok', () => {
    const [row] = rows(view({}));

    expect(text(row ?? '')).toContain(
      `Moda Kasabı·500,00 TL·Tamamlandı${formatDateTime(SUMMARY.createdAt)}`,
    );
    expect(row).toContain(`href="/hesabim/siparislerim/${ORDER_ID}"`);
    expect(row).toContain(`dateTime="${SUMMARY.createdAt}"`);
    expect(row).toContain('<svg');
  });

  it('siparisler sunucunun sirasinda (yeniden eskiye; yeniden siralanmaz)', () => {
    const html = view({
      orders: [
        order({ id: 'ord_00000000000000000000000000000002', marketName: 'B Market' }),
        order({ id: 'ord_00000000000000000000000000000001', marketName: 'A Market' }),
      ],
    });

    expect(html.indexOf('B Market')).toBeLessThan(html.indexOf('A Market'));
  });

  it('market adi yoksa genel ad', () => {
    const { marketName: _omit, ...withoutName } = SUMMARY;
    const [row] = rows(view({ orders: [withoutName] }));

    expect(text(row ?? '')).toContain(`${TEXTS.unknownMarketLabel}·500,00 TL`);
  });

  it('durumlar: suruyor sari rozet, iptal gri; iade edilen iptalde not', () => {
    const [going, cancelled, refunded] = rows(
      view({
        orders: [
          order({ id: 'ord_00000000000000000000000000000003', status: 'ON_THE_WAY' }),
          order({ id: 'ord_00000000000000000000000000000002', status: 'PAYMENT_FAILED' }),
          order({
            id: 'ord_00000000000000000000000000000001',
            status: 'CANCELLED',
            refunded: true,
          }),
        ],
      }),
    );

    expect(going).toMatch(/c-order-status--in-progress[^>]*>Devam ediyor</);
    expect(cancelled).toMatch(/c-order-status--cancelled[^>]*>İptal edildi</);
    expect(cancelled).not.toContain(TEXTS.refundedLabel);
    expect(text(refunded ?? '')).toContain('İptal edildi · Ücret iade edildi');
  });

  it('siparisi olmayan hesap: bos not, liste ve dugme yok', () => {
    const html = view({ orders: [] });

    expect(html).toContain('Geçmiş siparişiniz bulunmamaktadır.');
    expect(html).not.toContain('<li');
    expect(html).not.toContain(TEXTS.moreLabel);
  });

  it('ilk sayfa yuklenirken not; hata gelince tekrar dene', () => {
    expect(view({ orders: undefined })).toContain(TEXTS.loadingLabel);
    const failed = view({ orders: undefined, error: new Error('ag') });
    expect(failed).not.toContain(TEXTS.loadingLabel);
    expect(failed).toContain('<button');
  });

  it('"Daha fazla göster" yalnizca sonraki sayfa varsa; yuklenirken pasif ve "Yükleniyor…"', () => {
    expect(view({ hasMore: false })).not.toContain(TEXTS.moreLabel);
    expect(view({ hasMore: true })).toMatch(/<button[^>]*>Daha fazla göster<\/button>/);
    expect(view({ hasMore: true, loadingMore: true })).toMatch(
      /<button[^>]*disabled=""[^>]*>Yükleniyor…<\/button>/,
    );
  });

  it('sonraki sayfa hatasi: liste yerinde, altinda tekrar dene; "Daha fazla" gizli', () => {
    const html = view({ hasMore: true, moreError: new Error('ag') });

    expect(html).toContain('Moda Kasabı');
    expect(html).not.toContain(TEXTS.moreLabel);
    expect(html.lastIndexOf('<button')).toBeGreaterThan(html.indexOf('</ul>'));
  });
});
