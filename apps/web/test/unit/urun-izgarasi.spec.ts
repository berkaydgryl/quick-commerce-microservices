/**
 * Urun izgarasi ve sepet yazi boyu (07.10 kullanici karari): kartlar yuzdesel ve
 * satiri doldurur; sutun sayisi katalog sutununun genisligine gore 2, 3, en cok 4
 * (tek kural, token esikli). Sepet paneli ve telefon cubugunda metin tek boy (sm). Kurallar CSS'te: testler bildirimlerin yerinde kaldigini denetler,
 * olcum canli turda.
 */

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { ProductCard } from '../../src/features/catalog/ui/ProductCard';

import { block, css, tokens } from './css-test-support';

describe('urun izgarasi (magaza sayfasi; 07.10 kullanici karari: yuzdesel, satiri doldurur)', () => {
  const grid = block(
    css('features/catalog/ui/MarketCatalog.module.css'),
    '.c-market-catalog__grid',
  );

  it('tek kural: iz en az kart tokeni ya da genisligin dortte biri; esnek (1fr) ve satiri doldurur', () => {
    expect(grid.replace(/\s+/g, ' ')).toContain(
      'grid-template-columns: repeat( auto-fill, minmax(max(var(--size-product-card-min), calc((100% - var(--border-width-thin) * 3) / 4)), 1fr) )',
    );
  });

  it('kap sorgusu ve modulde sabit esik yok (kirilim token/ana kaynakta)', () => {
    const catalog = css('features/catalog/ui/MarketCatalog.module.css');

    expect(catalog).not.toContain('@container');
    expect(catalog).not.toContain('container-type');
    expect(tokens()).toMatch(/--size-product-card-min: [0-9.]+rem;/);
  });

  it('bos hucre beyaz: izgara zemini yuzey, cizgiler kartin golgesinden', () => {
    expect(grid).toContain('background: var(--bg-surface)');
    expect(block(css('features/catalog/ui/ProductCard.module.css'), '.c-product-card')).toContain(
      'box-shadow: 0 0 0 var(--border-width-thin) var(--border-faint)',
    );
  });

  it('uzun kelime karti genisletmez ("+" kartin icinde kalir)', () => {
    const card = css('features/catalog/ui/ProductCard.module.css');

    expect(block(card, '.c-product-card')).toContain('grid-template-columns: minmax(0, 1fr)');
    expect(block(card, '.c-product-card__description')).toContain('overflow-wrap: anywhere');
  });
});

describe('dar kartta rozet', () => {
  const card = (isActive: boolean) =>
    renderToStaticMarkup(
      createElement(ProductCard, {
        product: {
          id: 'prd_sut',
          offerId: 'ofr_sut',
          marketId: 'mkt_a',
          sku: 'SUT',
          name: 'Süt 1 L',
          categoryId: 'cat_sut',
          price: { amountMinor: 3490, currency: 'TRY' },
          isActive,
          availableQuantity: 2,
        },
        category: undefined,
        texts: { lowStockPrefix: 'Son', lowStockSuffix: 'adet' },
      }),
    );

  it('satista olmayan teklifte "Son N adet" yok ("Satışta değil" ile cakismasin)', () => {
    expect(card(true)).toContain('Son');
    expect(card(false)).not.toContain('Son');
  });
});

describe('sepet yazi boyu (panel ve telefon cubugu tek boy)', () => {
  it('panel ici metin tek boy (sm): "Sepete git" ve tutari, magaza adi, urun tutari', () => {
    const panel = css('features/cart/ui/CartPanel.module.css');

    for (const selector of [
      '.c-cart-panel__go',
      '.c-cart-panel__store-name',
      '.c-cart-panel__item-price',
    ]) {
      expect(block(panel, selector), selector).toContain('font-size: var(--font-size-sm)');
    }
  });

  it('telefon cubugu da sm', () => {
    expect(block(css('features/cart/ui/CartBar.module.css'), '.c-cart-bar__link')).toContain(
      'font-size: var(--font-size-sm)',
    );
  });
});
