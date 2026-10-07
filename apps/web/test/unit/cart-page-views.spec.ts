/**
 * Sepet sayfasinin gorunumleri (T16.3; referans getircarsi sepet sayfasi):
 * magaza kutusu (magaza baglantisi, satirda gorsel, ad, mor kalem tutari,
 * "Son N adet", adet kutusu; satir sonunda cop YOK, L3), "Sepet Toplamı"
 * (tutar, minimum sepete ve ucretsiz teslimata kalan; "Ödemeye Geç" F4'e
 * kadar pasif, L1), teslim suresi cipi, "Son N adet" esigi ve alt bilgi.
 */

import { CONTENT_FALLBACK } from '@getir/contracts';
import type { CartTotals } from '@getir/pricing';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import type { CartItem } from '../../src/features/cart/services/cart-state';
import { CartItemsCard } from '../../src/features/cart/ui/CartItemsCard';
import { CartTotalsCard } from '../../src/features/cart/ui/CartTotalsCard';
import { DeliveryTimeChip } from '../../src/features/markets/ui/DeliveryTimeChip';
import { LOW_STOCK_BADGE_MAX, lowStockCount } from '../../src/shared/services/low-stock';
import { SiteFooter } from '../../src/shared/ui/site-footer/SiteFooter';

const CART = CONTENT_FALLBACK.marketList.cart;
const PAGE = CONTENT_FALLBACK.cartPage;
const LOW = CONTENT_FALLBACK.marketPage;
const ROW_TEXTS = { ...CART, ...LOW };
const MARKET = { id: 'mkt_a101-caferaga', name: 'A101 – Caferağa' };

const item = (name: string, quantity: number, maxQuantity = 99): CartItem => ({
  productId: `prd_${name}`,
  offerId: `ofr_${name}`,
  sku: name.toUpperCase(),
  name,
  unitPriceMinor: 12_500,
  quantity,
  maxQuantity,
});

const TOTALS: CartTotals = {
  subtotalMinor: 37_500,
  discountMinor: 0,
  deliveryFeeMinor: 1_990,
  totalMinor: 39_490,
  canCheckout: true,
  amountToMinBasketMinor: 0,
  amountToFreeDeliveryMinor: 0,
  coupon: null,
};

function card(items: readonly CartItem[]): string {
  return renderToStaticMarkup(
    createElement(
      MemoryRouter,
      null,
      createElement(CartItemsCard, {
        market: MARKET,
        items,
        marketHref: '/markets/mkt_a101-caferaga',
        texts: ROW_TEXTS,
        renderVisual: (row: CartItem) => `GORSEL:${row.sku}`,
        canIncrement: () => true,
        onIncrement: () => undefined,
        onDecrement: () => undefined,
      }),
    ),
  );
}

function totals(value: CartTotals | undefined): string {
  return renderToStaticMarkup(
    createElement(CartTotalsCard, { totals: value, texts: PAGE, cartTexts: CART }),
  );
}

/** Ekran okuyucunun okudugu sira: etiketler atilir. */
const spoken = (markup: string) => markup.replace(/<[^>]+>/g, '');
const rows = (markup: string) => markup.split('<li').slice(1);

describe('CartItemsCard (T16.3)', () => {
  it('ustte magaza adi, magaza sayfasina baglanti', () => {
    expect(card([item('Süt', 1)])).toMatch(
      /<a[^>]*href="\/markets\/mkt_a101-caferaga"[^>]*>A101 – Caferağa<\/a>/,
    );
  });

  it('satir: gorsel (sayfanin), ad, mor kalem tutari (adet x fiyat)', () => {
    const [sut = ''] = rows(card([item('Süt', 3)]));

    expect(sut).toContain('GORSEL:SÜT');
    expect(sut).toContain('>Süt<');
    expect(sut).toContain('375,00 TL');
  });

  it('adet 1: "−" yerine cop; adet 2+: "−"; satir sonunda ayri cop YOK (L3)', () => {
    const [bir = '', iki = ''] = rows(card([item('Süt', 1), item('Ekmek', 2)]));

    expect(bir.match(/sepetten çıkar/g)).toHaveLength(1);
    expect(bir).not.toContain('adedini azalt');
    expect(iki).toContain('aria-label="Ekmek adedini azalt"');
    expect(iki).not.toContain('sepetten çıkar');
  });

  it('"Son N adet": kalemin stok siniri esigin altindaysa; platform sinirinda yok', () => {
    const [az = '', bol = ''] = rows(card([item('Süt', 1, 3), item('Ekmek', 1)]));

    expect(spoken(az)).toContain('Son 3 adet');
    expect(bol).not.toContain('Son ');
  });
});

describe('CartTotalsCard (T16.3)', () => {
  it('"Sepet Toplamı" basligi, "Sepet Tutarı" ve ara toplam', () => {
    const markup = totals(TOTALS);

    expect(markup).toMatch(/<h2[^>]*>Sepet Toplamı<\/h2>/);
    expect(spoken(markup)).toContain('Sepet Tutarı375,00 TL');
  });

  it('minimum sepete ve ucretsiz teslimata kalan (T16.3 olcutu)', () => {
    const markup = spoken(
      totals({
        ...TOTALS,
        canCheckout: false,
        amountToMinBasketMinor: 4_950,
        amountToFreeDeliveryMinor: 12_500,
      }),
    );

    expect(markup).toContain('Minimum sepet tutarına kalan: 49,50 TL');
    expect(markup).toContain('Ücretsiz teslimata kalan: 125,00 TL');
  });

  it('esikler gecildiyse not yok; kurallar gelmeden tutar ve not yok', () => {
    expect(totals(TOTALS)).not.toContain('kalan');
    expect(totals(undefined)).not.toContain('TL');
  });

  it('"Ödemeye Geç" F4 gelene kadar pasif (aria-disabled), baglanti degil (L1)', () => {
    const markup = totals(TOTALS);

    expect(markup).toMatch(
      /<button type="button"[^>]*aria-disabled="true"[^>]*>Ödemeye Geç<\/button>/,
    );
    expect(markup).not.toContain('href=');
  });
});

describe('DeliveryTimeChip (T16.3)', () => {
  it('"TVS 20-30 dk"; kisaltma ekran okuyucuya kapali, tam adi okunur', () => {
    const markup = renderToStaticMarkup(
      createElement(DeliveryTimeChip, {
        deliveryTime: { minMinutes: 20, maxMinutes: 30 },
        texts: { shortLabel: PAGE.deliveryTimeShortLabel, label: PAGE.deliveryTimeLabel },
      }),
    );

    expect(markup).toMatch(/aria-hidden="true">TVS<\/span> 20-30 dk/);
    expect(spoken(markup)).toContain('Tahmini varış süresi: TVS 20-30 dk');
  });
});

describe('"Son N adet" esigi (T16.3, L4) ve alt bilgi', () => {
  it('esik 5: 1..5 rozet; 0 (Tükendi), 6 ve bilinmeyen stokta rozet yok', () => {
    expect(LOW_STOCK_BADGE_MAX).toBe(5);
    expect([1, 5].map(lowStockCount)).toEqual([1, 5]);
    expect([0, 6, undefined].map(lowStockCount)).toEqual([undefined, undefined, undefined]);
  });

  it('alt bilgi: footer icinde telif satiri; sosyal ikon ve baglanti yok (L6)', () => {
    const markup = renderToStaticMarkup(
      createElement(SiteFooter, { copyright: CONTENT_FALLBACK.footer.copyright }),
    );

    expect(markup).toMatch(/<footer[^>]*>[\s\S]*© 2026 getir[\s\S]*<\/footer>/);
    expect(markup).not.toContain('<a');
    expect(markup).not.toContain('<svg');
  });
});
