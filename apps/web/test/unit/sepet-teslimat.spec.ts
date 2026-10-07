/**
 * Teslimat ucreti sepette (F15; 07.10 kullanici istegi): sepet panelinde
 * "Teslimat Ücreti" satiri (esik gecildiyse "Ücretsiz") ve "Sepete git"in
 * yaninda TOPLAM (teslimat dahil; telefon cubugu ve odeme sayfasiyla ayni
 * sayi, PM S1 (a)). /sepet'te Sepet Tutarı, Teslimat Ücreti, Toplam (odeme
 * ozetiyle ayni duzen, PM S2 (a)); "Ücretsiz teslimata kalan" kalir.
 */

import { CONTENT_FALLBACK } from '@getir/contracts';
import type { CartTotals } from '@getir/pricing';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import type { CartItem } from '../../src/features/cart/services/cart-state';
import { CartPanelView } from '../../src/features/cart/ui/CartPanelView';
import { CartTotalsCard } from '../../src/features/cart/ui/CartTotalsCard';

const CART = CONTENT_FALLBACK.marketList.cart;
const PAGE = CONTENT_FALLBACK.cartPage;

const ITEM: CartItem = {
  productId: 'prd_folyo',
  offerId: 'ofr_folyo',
  sku: 'FOLYO',
  name: 'Alüminyum Folyo 10 m',
  unitPriceMinor: 6_390,
  quantity: 1,
  maxQuantity: 20,
};

/** Esik altinda: 63,90 + 19,90 = 83,80. */
const PAID: CartTotals = {
  subtotalMinor: 6_390,
  discountMinor: 0,
  deliveryFeeMinor: 1_990,
  totalMinor: 8_380,
  canCheckout: false,
  amountToMinBasketMinor: 3_610,
  amountToFreeDeliveryMinor: 18_610,
  coupon: null,
};
/** Esik ustunde: teslimat ucretsiz. */
const FREE: CartTotals = {
  ...PAID,
  subtotalMinor: 30_000,
  deliveryFeeMinor: 0,
  totalMinor: 30_000,
  canCheckout: true,
  amountToMinBasketMinor: 0,
  amountToFreeDeliveryMinor: 0,
};

const text = (html: string) => html.replace(/<[^>]+>/g, '|').replace(/\|+/g, '|');

const panel = (totals: CartTotals) =>
  renderToStaticMarkup(
    createElement(
      MemoryRouter,
      null,
      createElement(CartPanelView, {
        texts: CART,
        market: { id: 'mkt_a101', name: 'A101' },
        items: [ITEM],
        totals,
        marketHref: '/markets/mkt_a101',
        cartHref: '/sepet',
        canIncrement: () => true,
        onIncrement: () => undefined,
        onDecrement: () => undefined,
        onRemove: () => undefined,
        onAskClear: () => undefined,
      }),
    ),
  );

const totalsCard = (totals: CartTotals | undefined) =>
  renderToStaticMarkup(
    createElement(
      MemoryRouter,
      null,
      createElement(CartTotalsCard, {
        totals,
        texts: PAGE,
        cartTexts: CART,
        checkoutHref: '/odeme',
      }),
    ),
  );

describe('sepet paneli', () => {
  it('"Teslimat Ücreti 19,90 TL" satiri; "Sepete git"in yaninda TOPLAM (83,80)', () => {
    const plain = text(panel(PAID));

    expect(CART.deliveryLabel).toBe('Teslimat Ücreti');
    expect(plain).toContain('|Teslimat Ücreti|19,90 TL|');
    expect(plain).toMatch(/\|Sepete git\|83,80 TL\|/);
  });

  it('esik gecildiyse "Ücretsiz"; toplam ara toplama esit', () => {
    const plain = text(panel(FREE));

    expect(plain).toContain('|Teslimat Ücreti|Ücretsiz|');
    expect(plain).toMatch(/\|Sepete git\|300,00 TL\|/);
  });
});

describe('/sepet "Sepet Toplamı"', () => {
  it('sirayla Sepet Tutarı, Teslimat Ücreti, Toplam (odeme ozetiyle ayni)', () => {
    const plain = text(totalsCard(PAID));

    expect(plain).toMatch(
      /\|Sepet Tutarı\|63,90 TL\|Teslimat Ücreti\|19,90 TL\|Toplam\|83,80 TL\|/,
    );
  });

  it('"Ücretsiz teslimata kalan" notu kalir; esik ustunde "Ücretsiz"', () => {
    expect(text(totalsCard(PAID))).toContain(PAGE.freeDeliveryRemainingLabel);
    expect(text(totalsCard(FREE))).toContain('|Teslimat Ücreti|Ücretsiz|');
  });

  it('toplam satiri ayri (ince cizgi, kalin mor; odeme ozetinin "Ödenecek Tutar"i gibi)', () => {
    expect(totalsCard(PAID)).toMatch(
      /class="[^"]*c-cart-totals__row--total[^"]*"><dt>Toplam<\/dt>/,
    );
  });

  it('tanim listesi (odeme ozeti gibi); kurallar gelmeden satirlar bos durur (dugme kaymaz)', () => {
    const markup = totalsCard(undefined);

    expect(totalsCard(PAID)).toMatch(
      /<dl[^>]*>(<div[^>]*><dt>[^<]+<\/dt><dd[^>]*>[^<]+<\/dd><\/div>){3}<\/dl>/,
    );
    expect(text(markup)).toContain('|Sepet Tutarı|Teslimat Ücreti|Toplam|');
    expect(markup).not.toContain('TL');
  });
});
