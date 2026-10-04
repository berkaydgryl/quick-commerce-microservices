/**
 * Sepetim paneli (T11.12; referans getircarsi): bos durum ve dolu sepet.
 * Toplamlar @getir/pricing'ten gelir; panel yalnizca yazar. Metinler icerikten
 * (burada icerik yedegi).
 */

import { CONTENT_FALLBACK } from '@getir/contracts';
import type { CartTotals } from '@getir/pricing';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import type { CartItem } from '../../src/features/cart/services/cart-state';
import { CartPanelView } from '../../src/features/cart/ui/CartPanelView';
import type { CartPanelViewProps } from '../../src/features/cart/ui/CartPanelView';

const TEXTS = CONTENT_FALLBACK.marketList.cart;

const ITEMS: readonly CartItem[] = [
  {
    productId: 'prd_sut-1l',
    offerId: 'ofr_migros-jet-moda-sut-1l',
    sku: 'SUT-1L',
    name: 'Süt 1 L',
    unitPriceMinor: 3490,
    quantity: 2,
  },
];

const TOTALS: CartTotals = {
  subtotalMinor: 6980,
  discountMinor: 0,
  deliveryFeeMinor: 2490,
  totalMinor: 9470,
  canCheckout: true,
  amountToMinBasketMinor: 0,
  amountToFreeDeliveryMinor: 23020,
  coupon: null,
};

function render(overrides: Partial<CartPanelViewProps>): string {
  const props: CartPanelViewProps = {
    texts: TEXTS,
    market: null,
    items: [],
    totals: undefined,
    cartHref: undefined,
    onClear: () => undefined,
    ...overrides,
  };
  return renderToStaticMarkup(
    createElement(MemoryRouter, null, createElement(CartPanelView, props)),
  );
}

describe('CartPanelView (T11.12)', () => {
  it('bos sepet: baslik ustte, "Sepetin şu an boş" ve aciklama; eylem yok', () => {
    const markup = render({});

    expect(markup).toMatch(/<h2[^>]*>Sepetim<\/h2>/);
    expect(markup).toContain('Sepetin şu an boş');
    expect(markup).toContain('Sipariş vermek için sepetine ürün ekle');
    expect(markup).not.toContain('Sepete git');
  });

  it('dolu sepet: market, kalem (ad x adet, tutar), toplamlar ve "Sepete git"', () => {
    const markup = render({
      market: { id: 'mkt_migros-jet-moda', name: 'Migros Jet – Moda' },
      items: ITEMS,
      totals: TOTALS,
      cartHref: '/markets/mkt_migros-jet-moda',
    });

    expect(markup).toContain('Migros Jet – Moda');
    expect(markup).toContain('Süt 1 L × 2');
    expect(markup).toContain('69,80 TL');
    expect(markup).toMatch(/<dt>Teslimat<\/dt><dd>24,90 TL<\/dd>/);
    expect(markup).toContain('94,70 TL');
    expect(markup).toContain('href="/markets/mkt_migros-jet-moda"');
    expect(markup).toContain('Sepeti boşalt');
    expect(markup).not.toContain('Minimum sepet');
  });

  it('teslimat ucretsizse tutar yerine "Ücretsiz"; minimum sepete kalan tutar uyarisi', () => {
    const markup = render({
      market: { id: 'mkt_a101-caferaga', name: 'A101 – Caferağa' },
      items: ITEMS,
      totals: { ...TOTALS, deliveryFeeMinor: 0, canCheckout: false, amountToMinBasketMinor: 3020 },
      cartHref: '/markets/mkt_a101-caferaga',
    });

    expect(markup).toMatch(/<dt>Teslimat<\/dt><dd>Ücretsiz<\/dd>/);
    expect(markup).toContain('Minimum sepet tutarına kalan: 30,20 TL');
  });

  it('kurallar gelene kadar toplamlar yazilmaz (kalemler gorunur)', () => {
    const markup = render({
      market: { id: 'mkt_migros-jet-moda', name: 'Migros Jet – Moda' },
      items: ITEMS,
      totals: undefined,
      cartHref: '/markets/mkt_migros-jet-moda',
    });

    expect(markup).toContain('Süt 1 L × 2');
    expect(markup).not.toContain('Ara toplam');
  });
});
