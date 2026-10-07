/**
 * Magaza sayfasinin katalog gorunumleri (T16.2; referans getircarsi):
 * "Kategoriler" listesi (basta "Tümü", secili satir aria-pressed, kategori
 * gorselleri) ve urun karti (fiyat, ad, aciklama, sag ustte eylem). Urun
 * gorselleri yayinda olmadigindan kartin gorseli urunun kategorisinindir;
 * product.imageUrl ISTENMEZ (K2: her urun 404 verirdi).
 */

import { CONTENT_FALLBACK } from '@getir/contracts';
import type { Category, Product } from '@getir/contracts';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { MarketCategoryNav } from '../../src/features/catalog/ui/MarketCategoryNav';
import { MarketProductGrid } from '../../src/features/catalog/ui/MarketProductGrid';

const LIST = CONTENT_FALLBACK.marketList;
const NAV_TEXTS = { title: LIST.categoriesTitle, allLabel: LIST.allLabel };

const SUT: Category = {
  id: 'cat_sut-kahvaltilik',
  name: 'Süt & Kahvaltılık',
  slug: 'sut-kahvaltilik',
  imageUrl: 'https://cdn.example.com/img/cat/sut.jpg',
};
const MEYVE: Category = {
  id: 'cat_meyve-sebze',
  name: 'Meyve & Sebze',
  slug: 'meyve-sebze',
  imageUrl: 'https://cdn.example.com/img/cat/manav.jpg',
};

const PEYNIR: Product = {
  id: 'prd_peynir-500',
  offerId: 'ofr_a101-peynir-500',
  marketId: 'mkt_a101-caferaga',
  sku: 'PEYNIR-500',
  name: 'Beyaz Peynir 500 g',
  description: 'Tam yağlı inek peyniri',
  categoryId: SUT.id,
  imageUrl: 'https://cdn.example.com/img/urun/peynir-500.png',
  price: { amountMinor: 18950, currency: 'TRY' },
  isActive: true,
};

function nav(selectedId: string | undefined): string {
  return renderToStaticMarkup(
    createElement(MarketCategoryNav, {
      categories: [SUT, MEYVE],
      selectedId,
      onSelect: () => undefined,
      texts: NAV_TEXTS,
    }),
  );
}

function grid(products: readonly Product[], categories: readonly Category[] | undefined): string {
  return renderToStaticMarkup(
    createElement(MarketProductGrid, {
      products,
      categories,
      renderAction: (product: Product) => `EYLEM:${product.sku}`,
    }),
  );
}

/** Dugmeler, sirayla. */
const buttons = (markup: string) => markup.split('<button').slice(1);

describe('MarketCategoryNav (T16.2)', () => {
  it('"Kategoriler" basligi (h2) ve listenin adi; basta "Tümü"', () => {
    const markup = nav(undefined);
    const [all, sut, meyve] = buttons(markup);

    expect(markup).toMatch(
      /<nav[^>]*aria-labelledby="([^"]+)"[\s\S]*<h2 id="\1"[^>]*>Kategoriler<\/h2>/,
    );
    expect(all).toContain('>Tümü<');
    expect(sut).toContain('>Süt &amp; Kahvaltılık<');
    expect(meyve).toContain('>Meyve &amp; Sebze<');
  });

  it('kategori secili degilken "Tümü" basili; secilen kategori basili, digerleri degil', () => {
    const [allNone, sutNone] = buttons(nav(undefined));
    expect(allNone).toContain('aria-pressed="true"');
    expect(sutNone).toContain('aria-pressed="false"');

    const [all, sut, meyve] = buttons(nav(MEYVE.id));
    expect(all).toContain('aria-pressed="false"');
    expect(sut).toContain('aria-pressed="false"');
    expect(meyve).toContain('aria-pressed="true"');
  });

  it('kategorinin gorseli; "Tümü"nun gorseli yok, yerine dort kare ikonu', () => {
    const [all, sut] = buttons(nav(undefined));

    expect(sut).toContain(`src="${SUT.imageUrl}"`);
    expect(all).not.toContain('<img');
    expect(all).toContain('c-category-nav__all-icon');
    expect(all).not.toMatch(/>T<\/span>/);
  });
});

describe('MarketProductGrid / ProductCard (T16.2)', () => {
  it('kart: mor fiyat, ad (h3), gri aciklama; sag ustte eylem', () => {
    const markup = grid([PEYNIR], [SUT]);

    expect(markup).toContain('189,50 TL');
    expect(markup).toMatch(/<h3[^>]*>Beyaz Peynir 500 g<\/h3>/);
    expect(markup).toContain('>Tam yağlı inek peyniri<');
    expect(markup).toMatch(/c-product-card__action[^"]*">EYLEM:PEYNIR-500</);
  });

  it('K2: gorsel urunun KATEGORISININ; urunun kendi gorseli istenmez', () => {
    const markup = grid([PEYNIR], [SUT, MEYVE]);

    expect(markup).toContain(`src="${SUT.imageUrl}"`);
    expect(markup).not.toContain('/img/urun/');
  });

  it('kategorisi bilinmeyen urun (kategoriler yuklenmedi): gorsel yok, urunun bas harfi', () => {
    const markup = grid([PEYNIR], undefined);

    expect(markup).not.toContain('<img');
    expect(markup).toMatch(/>B<\/span>/);
  });

  it('aciklamasi olmayan urunde aciklama satiri yok', () => {
    const { description: _description, ...plain } = PEYNIR;

    expect(grid([plain], [SUT])).not.toContain('c-product-card__description');
  });
});
