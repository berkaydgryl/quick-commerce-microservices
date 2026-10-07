/**
 * Magaza sayfasinin basi (T16.2; referans getircarsi): kapak ve bas harf
 * rozeti, ad (h1), yildizlar ve puan, teslimat satiri, acik/kapali durumu
 * (kapanis saati verisi yok, B3), "Hakkında" ve ucretsiz teslimat rozeti;
 * "Hakkında" penceresinin bilgileri. Metinler icerik yedeginden.
 */

import { CONTENT_FALLBACK } from '@getir/contracts';
import type { Market } from '@getir/contracts';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { ratingStars } from '../../src/features/markets/services/rating-stars';
import { MarketAboutDialog } from '../../src/features/markets/ui/MarketAboutDialog';
import { MarketHero } from '../../src/features/markets/ui/MarketHero';

import { nearbyMarket } from './market-list-test-support';

const PAGE = CONTENT_FALLBACK.marketPage;
const LIST = CONTENT_FALLBACK.marketList;
const KELEBEK: Market = {
  ...nearbyMarket({
    id: 'mkt_kelebek',
    name: 'Kelebek Çiçekçilik',
    brand: 'Kelebek Çiçekçilik',
    meters: 900,
  }).market,
  rating: { average: 4.43, count: 200 },
};

function hero(market: Market, action?: string): string {
  return renderToStaticMarkup(
    createElement(MarketHero, {
      market,
      pageTexts: PAGE,
      listTexts: LIST,
      action,
      onAbout: () => undefined,
    }),
  );
}

/** Ekran okuyucunun okudugu sira: etiketler atilir, bitisik metin bitisik kalir. */
const spoken = (markup: string) => markup.replace(/<[^>]+>/g, '');

/** Etiketler bosluga cevrilmis, bosluklari tek bosluga indirilmis metin (bloklar arasi). */
const text = (markup: string) =>
  markup
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

describe('ratingStars (T16.2)', () => {
  it('puan en yakin yarima yuvarlanir: 4,43 -> dort dolu, bir yarim', () => {
    expect(ratingStars(4.43)).toEqual(['full', 'full', 'full', 'full', 'half']);
  });

  it('4,2 -> dort dolu, bir bos; 0 -> bes bos; 5 -> bes dolu', () => {
    expect(ratingStars(4.2)).toEqual(['full', 'full', 'full', 'full', 'empty']);
    expect(ratingStars(0)).toEqual(['empty', 'empty', 'empty', 'empty', 'empty']);
    expect(ratingStars(5)).toEqual(['full', 'full', 'full', 'full', 'full']);
  });
});

describe('MarketHero (T16.2)', () => {
  it('kapak ve bas harf rozeti; ad sayfanin h1i', () => {
    const markup = hero(KELEBEK);

    expect(markup).toContain('src="https://cdn.example.com/img/market/market.jpg"');
    expect(markup).toMatch(/aria-hidden="true">KÇ<\/span>/);
    expect(markup).toMatch(/<h1[^>]*>Kelebek Çiçekçilik<\/h1>/);
  });

  it('kapagi olmayan magaza: gorsel istenmez, rozet yine var', () => {
    const { coverUrl: _cover, ...noCover } = KELEBEK;
    const markup = hero(noCover);

    expect(markup).not.toContain('<img');
    expect(markup).toContain('>KÇ</span>');
  });

  it('yildizlar (gorsel, ekran okuyucuya kapali) ve puan: "Puan 4,4 (200 değerlendirme)"', () => {
    const markup = hero(KELEBEK);

    expect(markup.match(/c-rating-stars__star/g)).toHaveLength(5);
    expect(markup).toMatch(/c-rating-stars[^"]*" aria-hidden="true"/);
    expect(spoken(markup)).toContain('Puan 4,4 (200 değerlendirme)');
  });

  it('teslimat satiri etiketsiz (K4): "15-25 dk · Min. 40,00 TL"', () => {
    expect(text(hero(KELEBEK))).toContain('15-25 dk · Min. 40,00 TL');
  });

  it('acik magaza "Açık", kapali "Kapalı"; sabit kapanis saati yazilmaz (K1)', () => {
    expect(text(hero(KELEBEK))).toContain(PAGE.openLabel);
    expect(text(hero({ ...KELEBEK, isOpen: false }))).toContain(LIST.closedLabel);
    expect(text(hero({ ...KELEBEK, isOpen: false }))).not.toContain(PAGE.openLabel);
    expect(hero(KELEBEK)).not.toMatch(/Kapanış|\d{2}:\d{2}/);
  });

  it('"Hakkında" dugme; ucretsiz teslimat rozeti; puanin yaninda eylem (kalp)', () => {
    const markup = hero(KELEBEK, 'KALP');

    expect(markup).toMatch(/<button type="button"[^>]*>Hakkında<span/);
    expect(text(markup)).toContain('300,00 TL üzeri ücretsiz teslimat');
    expect(spoken(markup)).toContain('(200 değerlendirme)KALP');
  });
});

describe('MarketAboutDialog (T16.2)', () => {
  it('baslik "Hakkında", kapat; marka, sure, minimum sepet, teslimat ucreti ve esik', () => {
    const markup = renderToStaticMarkup(
      createElement(MarketAboutDialog, { market: KELEBEK, texts: PAGE, onClose: () => undefined }),
    );

    expect(markup).toContain(`>${PAGE.aboutLabel}</h2>`);
    expect(markup).toContain(`aria-label="${PAGE.closeLabel}"`);
    const facts = text(markup);
    expect(facts).toContain(`${PAGE.brandLabel} Kelebek Çiçekçilik`);
    expect(facts).toContain(`${PAGE.deliveryTimeLabel} 15-25 dk`);
    expect(facts).toContain(`${PAGE.minBasketLabel} 40,00 TL`);
    expect(facts).toContain(`${PAGE.deliveryFeeLabel} 24,90 TL`);
    expect(facts).toContain(`${PAGE.freeDeliveryThresholdLabel} 300,00 TL`);
  });
});
