/**
 * Urunun sepet dugmesi (T16.2; T9.6: magaza karti ve ana sayfa aramasi ayni
 * bilesen): sepette yoksa "+" ("<ürün> sepete ekle"), varsa sepet panelinin
 * adet kutusu ve ayni adlar (K5); magaza kartinda dikey (ustte "+"), arama
 * satirinda yatay. "Satışta değil" ve "Tükendi" dugme degil. Metinler icerik
 * yedeginden; kurallar cart-state'te (bilesen yalnizca cizer).
 */

import { CONTENT_FALLBACK } from '@getir/contracts';
import type { Product } from '@getir/contracts';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { productCartTexts } from '../../src/features/cart/services/product-cart-texts';
import { ProductCartActionView } from '../../src/features/cart/ui/ProductCartAction';
import type { CartStepperOrientation } from '../../src/features/cart/ui/CartQuantityStepper';

const TEXTS = productCartTexts(CONTENT_FALLBACK.marketList.cart, CONTENT_FALLBACK.marketPage);

const PEYNIR: Product = {
  id: 'prd_peynir-500',
  offerId: 'ofr_a101-peynir-500',
  marketId: 'mkt_a101-caferaga',
  sku: 'PEYNIR-500',
  name: 'Beyaz Peynir 500 g',
  categoryId: 'cat_sut-kahvaltilik',
  price: { amountMinor: 18950, currency: 'TRY' },
  isActive: true,
};

interface Options {
  readonly product?: Product;
  readonly quantity?: number;
  readonly addable?: boolean;
  readonly soldOut?: boolean;
  readonly orientation?: CartStepperOrientation;
}

function render({
  product = PEYNIR,
  quantity = 0,
  addable = true,
  soldOut = false,
  orientation,
}: Options): string {
  return renderToStaticMarkup(
    createElement(ProductCartActionView, {
      product,
      quantity,
      addable,
      soldOut,
      texts: TEXTS,
      orientation,
      onAdd: () => undefined,
      onDecrement: () => undefined,
    }),
  );
}

/** Dugmelerin erisilebilir adlari, DOM (Tab) sirasiyla. */
const labels = (markup: string) =>
  [...markup.matchAll(/<button[^>]*aria-label="([^"]+)"/g)].map((match) => match[1]);

describe('productCartTexts (T16.2)', () => {
  it('adet kutusunun adlari sepet panelinden, "+" ve durumlar magaza sayfasindan', () => {
    expect(TEXTS).toEqual({
      decreaseSuffix: 'adedini azalt',
      increaseSuffix: 'adedini artır',
      removeSuffix: 'sepetten çıkar',
      quantitySuffix: 'adedi',
      addSuffix: 'sepete ekle',
      soldOutLabel: 'Tükendi',
      unavailableLabel: 'Satışta değil',
    });
  });
});

describe('ProductCartActionView (T16.2)', () => {
  it('sepette yok: tek "+" dugmesi, adi "<ürün> sepete ekle"; eklenemezse pasif', () => {
    expect(labels(render({}))).toEqual(['Beyaz Peynir 500 g sepete ekle']);
    expect(render({})).not.toContain('disabled');
    expect(render({ addable: false })).toContain('disabled=""');
  });

  it('magaza karti (dikey), adet 1: ustte "+", ortada adet, altta cop kutusu (K5 adlari)', () => {
    const markup = render({ quantity: 1, orientation: 'vertical' });

    expect(labels(markup)).toEqual([
      'Beyaz Peynir 500 g adedini artır',
      'Beyaz Peynir 500 g sepetten çıkar',
    ]);
    expect(markup).toContain('c-cart-stepper--vertical');
    expect(markup).toContain('aria-label="Beyaz Peynir 500 g adedi"');
    expect(markup).toMatch(/aria-live="polite">1</);
  });

  it('arama satiri (yatay, varsayilan), adet 2: solda "−", sagda "+"', () => {
    const markup = render({ quantity: 2 });

    expect(labels(markup)).toEqual([
      'Beyaz Peynir 500 g adedini azalt',
      'Beyaz Peynir 500 g adedini artır',
    ]);
    expect(markup).not.toContain('c-cart-stepper--vertical');
  });

  it('sepette ve sinirda: "+" pasif (canAdd)', () => {
    expect(render({ quantity: 3, addable: false })).toMatch(/adedini artır" disabled=""/);
  });

  it('satista olmayan teklif "Satışta değil", stogu biten "Tükendi"; dugme degil', () => {
    const inactive = render({ product: { ...PEYNIR, isActive: false }, addable: false });
    const soldOut = render({ soldOut: true, addable: false });

    expect(inactive).toContain('>Satışta değil<');
    expect(soldOut).toContain('>Tükendi<');
    expect(inactive).not.toContain('<button');
    expect(soldOut).not.toContain('<button');
  });

  it('sepetteyken satistan kalkan ya da tukenen urun: adet kutusu kalir, azaltilabilir', () => {
    const markup = render({
      product: { ...PEYNIR, isActive: false },
      quantity: 2,
      soldOut: true,
      addable: false,
    });

    expect(labels(markup)).toContain('Beyaz Peynir 500 g adedini azalt');
    expect(markup).toMatch(/adedini artır" disabled=""/);
  });
});
