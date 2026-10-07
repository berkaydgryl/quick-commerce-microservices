/**
 * Kapali market (07.10 kullanici istegi): "+" gri ve pasif ama odaklanabilir
 * (aria-disabled, sebep satirina bagli), basinca hicbir sey olmaz; urun
 * kartlari gri. Sepet paneli "Market şu an kapalı" der, "Sepete git" aktif
 * kalir; /sepet "Ödemeye Geç"i pasif ve sebebe bagli. Ekleme kancasi kapali
 * markette sepeti degistirmez (ikinci kat).
 */

import { CONTENT_FALLBACK } from '@getir/contracts';
import type { Category, Product } from '@getir/contracts';
import type { CartTotals } from '@getir/pricing';
import { createElement } from 'react';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { switchTarget, useAddToCart } from '../../src/features/cart/hooks/useAddToCart';
import {
  canAdd,
  canIncrement,
  EMPTY_CART,
  isMarketClosed,
} from '../../src/features/cart/services/cart-state';
import type { CartItem } from '../../src/features/cart/services/cart-state';
import { productCartTexts } from '../../src/features/cart/services/product-cart-texts';
import { useCartStore } from '../../src/features/cart/stores/useCartStore';
import { CartBarView } from '../../src/features/cart/ui/CartBar';
import { CartPanelView } from '../../src/features/cart/ui/CartPanelView';
import { CartTotalsCard } from '../../src/features/cart/ui/CartTotalsCard';
import { ClosedMarketNotice } from '../../src/features/cart/ui/ClosedMarketNotice';
import { ProductCartActionView } from '../../src/features/cart/ui/ProductCartAction';
import { ProductCard } from '../../src/features/catalog/ui/ProductCard';

const CART = CONTENT_FALLBACK.marketList.cart;
const TEXTS = productCartTexts(CART, CONTENT_FALLBACK.marketPage);
const MARKET = { id: 'mkt_a101-abbasaga', name: 'A101 – Abbasağa' };
const REASON_ID = 'kapali-sebep';

const PEYNIR: Product = {
  id: 'prd_peynir-500',
  offerId: 'ofr_a101-peynir-500',
  marketId: MARKET.id,
  sku: 'PEYNIR-500',
  name: 'Beyaz Peynir 500 g',
  categoryId: 'cat_sut-kahvaltilik',
  price: { amountMinor: 18950, currency: 'TRY' },
  isActive: true,
};

const ITEM: CartItem = {
  productId: PEYNIR.id,
  offerId: PEYNIR.offerId,
  sku: PEYNIR.sku,
  name: PEYNIR.name,
  unitPriceMinor: 18950,
  quantity: 1,
  maxQuantity: 20,
};

const TOTALS: CartTotals = {
  subtotalMinor: 18950,
  discountMinor: 0,
  deliveryFeeMinor: 1990,
  totalMinor: 20940,
  canCheckout: true,
  amountToMinBasketMinor: 0,
  amountToFreeDeliveryMinor: 0,
  coupon: null,
};

/** Kapaliyken addable da false gelir (cart-state canAdd). */
const actionProps = (quantity: number, closed: boolean) => ({
  product: PEYNIR,
  quantity,
  addable: !closed,
  soldOut: false,
  texts: TEXTS,
  closed,
  closedReasonId: REASON_ID,
  onAdd: () => undefined,
  onDecrement: () => undefined,
});

const action = (quantity: number, closed = false) =>
  renderToStaticMarkup(createElement(ProductCartActionView, actionProps(quantity, closed)));

const inRouter = (node: ReactElement) =>
  renderToStaticMarkup(createElement(MemoryRouter, null, node));

/** Bir dugmenin acilis etiketi (aria-label ile bulunur). */
const buttonTag = (markup: string, label: string) =>
  new RegExp(`<button[^>]*aria-label="${label}"[^>]*>`).exec(markup)?.[0] ?? '';

describe('"+" (magaza karti ve arama satiri)', () => {
  const addLabel = `${PEYNIR.name} ${TEXTS.addSuffix}`;

  it('kapali: aria-disabled ve sebep satirina bagli; disabled DEGIL (odaklanir, sebep okunur)', () => {
    const tag = buttonTag(action(0, true), addLabel);

    expect(tag).toContain('aria-disabled="true"');
    expect(tag).toContain(`aria-describedby="${REASON_ID}"`);
    expect(tag).not.toContain('disabled=""');
  });

  it('kapali: basinca hicbir sey olmaz (tiklama baglanmaz)', () => {
    const closed = ProductCartActionView(actionProps(0, true)) as ReactElement<{
      onClick?: unknown;
    }>;
    const open = ProductCartActionView(actionProps(0, false)) as ReactElement<{
      onClick?: unknown;
    }>;

    expect(closed.props.onClick).toBeUndefined();
    expect(open.props.onClick).toBeTypeOf('function');
  });

  it('acik: bugunku gibi (aria-disabled ve sebep yok; kimlik verilse de)', () => {
    const tag = buttonTag(action(0), addLabel);

    expect(tag).not.toContain('aria-disabled');
    expect(tag).not.toContain('aria-describedby');
  });

  it('sepette olan urun: adet "+"si pasif ama odaklanir ve sebebe bagli; "−"/cop calisir', () => {
    const markup = action(1, true);
    const increase = buttonTag(markup, `${PEYNIR.name} ${TEXTS.increaseSuffix}`);

    expect(increase).toContain('aria-disabled="true"');
    expect(increase).toContain(`aria-describedby="${REASON_ID}"`);
    expect(increase).not.toContain('disabled=""');
    expect(buttonTag(markup, `${PEYNIR.name} ${TEXTS.removeSuffix}`)).not.toContain('disabled');
  });

  it('acik ve sinirda: adet "+"si bugunku gibi disabled (sebep yok)', () => {
    const markup = renderToStaticMarkup(
      createElement(ProductCartActionView, { ...actionProps(1, false), addable: false }),
    );
    const increase = buttonTag(markup, `${PEYNIR.name} ${TEXTS.increaseSuffix}`);

    expect(increase).toContain('disabled=""');
    expect(increase).not.toContain('aria-describedby');
  });
});

describe('kural tek yerde (cart-state, D11)', () => {
  it('isMarketClosed: yalniz isOpen false iken; bilinmiyorsa kapali sayilmaz', () => {
    expect(isMarketClosed({ isOpen: false })).toBe(true);
    expect(isMarketClosed({ isOpen: true })).toBe(false);
    expect(isMarketClosed(undefined)).toBe(false);
  });

  it('kapali markette canAdd ve canIncrement false', () => {
    const cart = { market: MARKET, items: [ITEM] };

    expect(canAdd(EMPTY_CART, PEYNIR, true)).toBe(false);
    expect(canAdd(EMPTY_CART, PEYNIR)).toBe(true);
    expect(canIncrement(cart, ITEM.offerId, true)).toBe(false);
    expect(canIncrement(cart, ITEM.offerId)).toBe(true);
  });
});

describe('urun karti', () => {
  const category: Category | undefined = undefined;
  const card = (closed: boolean) =>
    renderToStaticMarkup(
      createElement(ProductCard, {
        product: PEYNIR,
        category,
        texts: { lowStockPrefix: 'Son', lowStockSuffix: 'adet' },
        closed,
      }),
    );

  it('kapali: kart is-closed (gorsel ve "+" gri); ad ve fiyat yerinde', () => {
    const markup = card(true);

    expect(markup).toMatch(/^<li class="[^"]*c-product-card[^"]* [^"]*is-closed/);
    expect(markup).toContain(PEYNIR.name);
    expect(markup).toContain('189,50');
  });

  it('acik: is-closed yok', () => {
    expect(card(false)).not.toContain('is-closed');
  });
});

describe('sebep satiri', () => {
  it('kimligi "+"lerin bagladigi kimlik; metin icerikten ("Market şu an kapalı")', () => {
    expect(CART.closedNotice).toBe('Market şu an kapalı');
    expect(
      renderToStaticMarkup(
        createElement(ClosedMarketNotice, { id: REASON_ID, text: CART.closedNotice }),
      ),
    ).toMatch(new RegExp(`^<p id="${REASON_ID}"[^>]*>Market şu an kapalı</p>$`));
  });
});

describe('sepet paneli (PM S3: "Sepete git" aktif)', () => {
  const panel = (closed: boolean, totals: CartTotals) =>
    inRouter(
      createElement(CartPanelView, {
        texts: CART,
        market: MARKET,
        items: [ITEM],
        totals,
        marketHref: `/markets/${MARKET.id}`,
        cartHref: '/sepet',
        closed,
        canIncrement: () => true,
        onIncrement: () => undefined,
        onDecrement: () => undefined,
        onRemove: () => undefined,
        onAskClear: () => undefined,
      }),
    );

  it('kapali: not "Market şu an kapalı"; minimum sepet notu yerine; "Sepete git" baglanti', () => {
    const markup = panel(true, { ...TOTALS, canCheckout: false, amountToMinBasketMinor: 1000 });

    expect(markup).toContain(CART.closedNotice);
    expect(markup).not.toContain(CART.minBasketRemainingLabel);
    expect(markup).toMatch(/<a[^>]*href="\/sepet"[^>]*>/);
  });

  it('acik: not yok', () => {
    expect(panel(false, TOTALS)).not.toContain(CART.closedNotice);
  });
});

describe('/sepet "Ödemeye Geç"', () => {
  const card = (closed: boolean) =>
    inRouter(
      createElement(CartTotalsCard, {
        totals: TOTALS,
        texts: CONTENT_FALLBACK.cartPage,
        cartTexts: CART,
        checkoutHref: '/odeme',
        closed,
      }),
    );

  it('kapali: pasif (aria-disabled) ve nota bagli; odeme sayfasina baglanti YOK', () => {
    const markup = card(true);
    const notice = /<p id="([^"]+)"[^>]*>Market şu an kapalı<\/p>/.exec(markup);

    expect(notice).not.toBeNull();
    expect(markup).toMatch(
      new RegExp(`<button[^>]*aria-disabled="true"[^>]*aria-describedby="${notice?.[1]}"`),
    );
    expect(markup).not.toContain('href="/odeme"');
  });

  it('acik ve minimum tutuyor: bugunku gibi baglanti', () => {
    expect(card(false)).toContain('href="/odeme"');
  });

  it('kapali: "Ücretsiz teslimata kalan" de yok (urun eklenemez)', () => {
    const markup = inRouter(
      createElement(CartTotalsCard, {
        totals: { ...TOTALS, amountToFreeDeliveryMinor: 3500 },
        texts: CONTENT_FALLBACK.cartPage,
        cartTexts: CART,
        checkoutHref: '/odeme',
        closed: true,
      }),
    );

    expect(markup).not.toContain(CONTENT_FALLBACK.cartPage.freeDeliveryRemainingLabel);
  });
});

describe('telefon sepet cubugu (panelin yerine)', () => {
  const bar = (closed: boolean) =>
    inRouter(
      createElement(CartBarView, {
        texts: CART,
        href: '/sepet',
        count: 1,
        totalMinor: 20940,
        closed,
      }),
    );

  it('acik: bugunku gibi "Sepetim · 1 ürün"', () => {
    expect(bar(false)).toContain(`${CART.title} · 1 ${CART.itemCountLabel}`);
    expect(bar(false)).not.toContain(CART.closedNotice);
  });

  it('kapali: "Market şu an kapalı"; "Sepete git" aktif baglanti', () => {
    const markup = bar(true);

    expect(markup).toContain(CART.closedNotice);
    expect(markup).toMatch(/<a[^>]*href="\/sepet"/);
  });
});

describe('ekleme kancasi (ikinci kat)', () => {
  beforeEach(() => {
    useCartStore.setState(EMPTY_CART);
  });

  afterEach(() => {
    useCartStore.setState(EMPTY_CART);
  });

  /** Kancanin eylemlerini cizimden SONRA cagirmak icin yakalar (cizimde yan etki yok). */
  function addWith(closed: boolean): void {
    let add: ((product: Product) => void) | undefined;
    function Capture() {
      add = useAddToCart(MARKET, closed).add;
      return null;
    }
    renderToStaticMarkup(createElement(Capture));
    add?.(PEYNIR);
  }

  it('kapali markette add() sepeti degistirmez', () => {
    addWith(true);

    expect(useCartStore.getState().items).toEqual([]);
  });

  it('acik markette ekler (kontrol)', () => {
    addWith(false);

    expect(useCartStore.getState().items).toHaveLength(1);
  });

  it('pencere acikken market kapanirsa onay sepeti degistirmez (switchTarget)', () => {
    const pending = { product: PEYNIR, currentMarket: { id: 'mkt_baska', name: 'Başka' } };

    expect(switchTarget(pending, MARKET, true)).toBeUndefined();
    expect(switchTarget(pending, MARKET, false)).toEqual({ product: PEYNIR, market: MARKET });
  });
});
