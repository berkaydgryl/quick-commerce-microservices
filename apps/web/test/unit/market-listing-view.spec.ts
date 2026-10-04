/**
 * Market listesi gorunumu (T11.12; referans getircarsi): uc bolge (gruplu
 * dukkan turleri, kartlar, Sepetim yuvasi), "N isletme listeleniyor", tur
 * suzgeci ve durumlar. Metinler icerikten (burada icerik yedegi). Yerlesim ve
 * piksel hizasi tarayicida canli olculur; burada cizilen icerik denetlenir.
 */

import { CONTENT_FALLBACK } from '@getir/contracts';
import type { StoreType } from '@getir/contracts';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import { MarketListingView } from '../../src/features/markets/ui/MarketListingView';
import type { MarketListingViewProps } from '../../src/features/markets/ui/MarketListingView';

import { NEARBY } from './market-list-test-support';

const CONTENT = CONTENT_FALLBACK.marketList;

function render(overrides: Partial<MarketListingViewProps> = {}): string {
  const props: MarketListingViewProps = {
    content: CONTENT,
    markets: NEARBY,
    error: null,
    onRetry: () => undefined,
    selected: undefined,
    onSelect: () => undefined,
    headingLevel: 2,
    aside: createElement('p', null, 'SEPET-YUVASI'),
    ...overrides,
  };
  return renderToStaticMarkup(
    createElement(MemoryRouter, null, createElement(MarketListingView, props)),
  );
}

const cardLinks = (markup: string) =>
  [...markup.matchAll(/href="\/markets\/([^"]+)"/g)].map((match) => match[1]);
const pressed = (markup: string) =>
  [...markup.matchAll(/aria-pressed="true"[^>]*>(?:<span>)?([^<]+)/g)].map((match) => match[1]);

describe('MarketListingView (T11.12)', () => {
  it('uc bolge: solda Kategoriler menusu, ortada liste, sagda Sepetim yuvasi', () => {
    const markup = render();

    expect(markup).toMatch(/<nav[^>]*>.*Kategoriler/);
    expect(markup).toMatch(/<section/);
    expect(markup).toMatch(/<aside[^>]*><p>SEPET-YUVASI<\/p><\/aside>/);
  });

  it('"N isletme listeleniyor": turu bilinmeyen market de listede (yalnizca Tumu altinda)', () => {
    const markup = render();

    expect(markup).toMatch(/<h2[^>]*><span[^>]*>4<\/span> işletme listeleniyor<\/h2>/);
    expect(cardLinks(markup)).toEqual([
      'mkt_a101-caferaga',
      'mkt_moda-kasabi',
      'mkt_migros-jet-moda',
      'mkt_eski-surum',
    ]);
  });

  it('menu yalnizca adreste marketi olan grup ve turleri gosterir (gruplar icerikten)', () => {
    const markup = render();

    expect(markup).toContain('Gıda &amp; Market');
    expect(markup).not.toContain('Pet Shop');
    expect(markup).not.toContain('Çiçek');
    // Kapali akordeon: tur dugmeleri gizli panelde.
    expect(markup).toMatch(/aria-expanded="false"[^>]*>.*Gıda &amp; Market/);
  });

  it('kart: bas harf rozeti, puan (ekran okuyucu adiyla), sure, min. tutar, ucretsiz teslimat esigi', () => {
    const markup = render();

    expect(markup).toContain('>MJ<');
    expect(markup).toContain('Puan ');
    expect(markup).toContain('4,7');
    expect(markup).toContain(' değerlendirme');
    expect(markup).toContain('15-25 dk · Min. 40,00 TL');
    expect(markup).toContain('300,00 TL üzeri ücretsiz teslimat');
  });

  it('kapali market listede kalir: "Kapalı" etiketi yalnizca onda', () => {
    expect(render().match(/>Kapalı</g)).toHaveLength(1);
  });

  it('tur secilince yalnizca o tur; secim menude ve ciplerde basili, "Filtreyi kaldır" gorunur', () => {
    const markup = render({ selected: 'KASAP' satisfies StoreType });

    expect(cardLinks(markup)).toEqual(['mkt_moda-kasabi']);
    expect(markup).toMatch(/<span[^>]*>1<\/span> işletme listeleniyor/);
    expect(pressed(markup)).toEqual(['Kasap', 'Kasap']);
    expect(markup).toContain('Filtreyi kaldır');
    // Secili turun grubu acik baslar.
    expect(markup).toMatch(/aria-expanded="true"[^>]*>.*Gıda &amp; Market/);
  });

  it('suzgec yokken ciplerde "Tümü" basili, "Filtreyi kaldır" yok', () => {
    const markup = render();

    expect(pressed(markup)).toEqual(['Tümü']);
    expect(markup).not.toContain('Filtreyi kaldır');
  });

  it('secili turde market yoksa ayri bildirim; adreste hic market yoksa bos bildirim', () => {
    expect(render({ selected: 'CICEKCI' })).toContain(CONTENT.filterEmptyNotice);
    const empty = render({ markets: [] });
    expect(empty).toContain(CONTENT.emptyNotice);
    expect(empty).toMatch(/<span[^>]*>0<\/span> işletme listeleniyor/);
  });

  it('yuklenirken durum satiri, sayi basligi yok; hata mesaji gorunur', () => {
    const loading = render({ markets: undefined });
    expect(loading).toMatch(/role="status"[^>]*>İşletmeler yükleniyor…/);
    expect(loading).not.toContain('işletme listeleniyor');

    const failed = render({ markets: undefined, error: new Error('Marketler alınamadı') });
    expect(failed).toContain('Marketler alınamadı');
  });

  it('/markets sayfasinda liste basligi h1, market adlari h2', () => {
    const markup = render({ headingLevel: 1 });

    expect(markup).toMatch(/<h1[^>]*><span[^>]*>4<\/span> işletme listeleniyor<\/h1>/);
    expect(markup).toMatch(/<h2[^>]*><a[^>]*>A101 – Caferağa<\/a><\/h2>/);
  });

  it('kart eylemi (T11.13 kalp) kapakta ve baglantinin DISINDA: her kartta bir tane', () => {
    const markup = render({
      renderCardAction: (market) =>
        createElement('button', { type: 'button' }, `KALP-${market.id}`),
    });

    expect(markup.match(/<button type="button">KALP-/g)).toHaveLength(4);
    // Baglanti yalnizca market adini sarar; icinde dugme yok.
    expect(markup).not.toMatch(/<a [^>]*>(?:(?!<\/a>).)*<button/);
  });
});
