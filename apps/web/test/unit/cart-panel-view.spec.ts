/**
 * Sepetim paneli (T16.3; referans getircarsi): bos durum; dolu sepette magaza
 * satiri (ad magazaya gider, cop kutusu onay ister), satirlarda ad ve mor
 * kalem tutari, adet kutusu (adet 1'de "−" yerine cop kutusu ve satir sonundaki
 * cop gizli; adet 2+'da "−" ve satir sonunda cop), minimum sepete kalan notu ve
 * "Sepete git" + sepet tutari. Metinler icerik yedeginden.
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
import { ClearCartDialog } from '../../src/features/cart/ui/ClearCartDialog';

const TEXTS = CONTENT_FALLBACK.marketList.cart;
const MARKET = { id: 'mkt_kelebek', name: 'Kelebek Çiçekçilik' };

const item = (name: string, quantity: number, unitPriceMinor: number): CartItem => ({
  productId: `prd_${name}`,
  offerId: `ofr_${name}`,
  sku: name.toUpperCase(),
  name,
  unitPriceMinor,
  quantity,
  maxQuantity: 20,
});

const AGAC = item('Saksıda Küçük Ağaç', 1, 200_000);
const GUL = item('Ambalajda Tekli Kırmızı Gül', 2, 19_999);

const TOTALS: CartTotals = {
  subtotalMinor: 239_998,
  discountMinor: 0,
  deliveryFeeMinor: 0,
  totalMinor: 239_998,
  canCheckout: true,
  amountToMinBasketMinor: 0,
  amountToFreeDeliveryMinor: 0,
  coupon: null,
};

function render(overrides: Partial<CartPanelViewProps>): string {
  const props: CartPanelViewProps = {
    texts: TEXTS,
    market: MARKET,
    items: [AGAC, GUL],
    totals: TOTALS,
    marketHref: '/markets/mkt_kelebek',
    cartHref: '/markets/mkt_kelebek',
    canIncrement: () => true,
    onIncrement: () => undefined,
    onDecrement: () => undefined,
    onRemove: () => undefined,
    onAskClear: () => undefined,
    ...overrides,
  };
  return renderToStaticMarkup(
    createElement(MemoryRouter, null, createElement(CartPanelView, props)),
  );
}

/** Satirlar (li), sirayla. */
const rows = (markup: string) => markup.split('<li').slice(1);
const count = (text: string, needle: string) => text.split(needle).length - 1;

describe('CartPanelView (T16.3)', () => {
  it('bos sepet: baslik ustte, "Sepetin şu an boş" ve aciklama; eylem yok', () => {
    const markup = render({ market: null, items: [], totals: undefined });

    expect(markup).toMatch(/<h2[^>]*>Sepetim<\/h2>/);
    expect(markup).toContain(TEXTS.emptyTitle);
    expect(markup).not.toContain(TEXTS.goToCartLabel);
  });

  it('magaza satiri: ad magaza sayfasina baglanti, cop kutusu "Sepeti boşalt" (onay acar)', () => {
    const markup = render({});

    expect(markup).toMatch(/<a[^>]*href="\/markets\/mkt_kelebek"[^>]*>Kelebek Çiçekçilik<\/a>/);
    expect(markup).toContain(`aria-label="${TEXTS.clearLabel}"`);
  });

  it('satir: ad ve mor kalem tutari (adet x fiyat)', () => {
    const [agac, gul] = rows(render({}));

    expect(agac).toContain('>Saksıda Küçük Ağaç<');
    expect(agac).toContain('2.000,00 TL');
    expect(gul).toContain('399,98 TL');
  });

  it('adet 1: "−" yerine cop kutusu (sepetten çıkar); satir sonundaki cop GIZLI', () => {
    const [agac = ''] = rows(render({}));

    expect(agac).toContain(`aria-label="Saksıda Küçük Ağaç ${TEXTS.removeSuffix}"`);
    expect(agac).not.toContain(TEXTS.decreaseSuffix);
    expect(count(agac, TEXTS.removeSuffix)).toBe(1);
  });

  it('adet 2+: "−" (adedini azalt) ve satir sonunda ayrica cop kutusu', () => {
    const [, gul = ''] = rows(render({}));

    expect(gul).toContain(`aria-label="Ambalajda Tekli Kırmızı Gül ${TEXTS.decreaseSuffix}"`);
    expect(gul).toContain(`aria-label="Ambalajda Tekli Kırmızı Gül ${TEXTS.removeSuffix}"`);
    expect(gul).toContain(`aria-label="Ambalajda Tekli Kırmızı Gül ${TEXTS.quantitySuffix}"`);
    expect(gul).toMatch(/aria-live="polite">2</);
  });

  it('"+" kalemin sinirinda pasif (canIncrement)', () => {
    const [agac, gul] = rows(render({ canIncrement: (offerId) => offerId !== GUL.offerId }));

    expect(agac).not.toMatch(/adedini artır" disabled/);
    expect(gul).toMatch(/aria-label="Ambalajda Tekli Kırmızı Gül adedini artır" disabled=""/);
  });

  it('"Sepete git" ve sagda sepet tutari; minimum sepete kalan notu', () => {
    const markup = render({
      totals: { ...TOTALS, canCheckout: false, amountToMinBasketMinor: 135_002 },
    });

    expect(markup).toMatch(
      /<a[^>]*href="\/markets\/mkt_kelebek"[^>]*><span[^>]*>Sepete git<\/span><span[^>]*>2\.399,98 TL<\/span><\/a>/,
    );
    expect(markup.replace(/<[^>]+>/g, '')).toContain(
      `${TEXTS.minBasketRemainingLabel}: 1.350,02 TL`,
    );
  });

  it('kurallar gelene kadar tutar ve not yazilmaz; "Sepete git" yine var', () => {
    const markup = render({ totals: undefined });

    expect(markup).toContain(`>${TEXTS.goToCartLabel}</span></a>`);
    expect(markup).not.toContain(TEXTS.minBasketRemainingLabel);
  });

  it('magaza sayfasinda baslik ekran okuyucuya kalir (gorunmez sinif)', () => {
    expect(render({ titleVisible: false })).toMatch(/<h2[^>]*title--hidden[^>]*>Sepetim<\/h2>/);
  });
});

describe('ClearCartDialog (T16.3)', () => {
  it('soru, not, "Vazgeç" ve "Boşalt"; konu (kalin) yok', () => {
    const markup = renderToStaticMarkup(
      createElement(ClearCartDialog, {
        texts: TEXTS,
        onConfirm: () => undefined,
        onCancel: () => undefined,
      }),
    );

    expect(markup).toContain(`>${TEXTS.clearLabel}</h2>`);
    expect(markup).toContain(`>${TEXTS.clearConfirmQuestion}</p>`);
    expect(markup).toContain(TEXTS.clearConfirmHint);
    expect(markup).toContain(`>${TEXTS.cancelLabel}</button>`);
    expect(markup).toContain(`>${TEXTS.clearConfirmLabel}</button>`);
    expect(markup).not.toContain('<strong');
  });
});
