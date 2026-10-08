/**
 * Kapagin marka kutusu (T11.11; 07.10 kullanici karari): kapagin sol ORTASINDA,
 * soldan yuzde (token) iceride; logoUrl varsa beyaz kutuda dekoratif logo
 * (alt="": market adi yaninda metin), yoksa bas harf rozeti. Liste karti ve
 * magaza kapagi ayni bileseni kullanir. Gecici yazi logolar (img/market-logo):
 * yalniz ad ve renk, <title> yok, betik ve dis baglanti yok, kucuk.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { CONTENT_FALLBACK } from '@getir/contracts';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import { MarketBadge } from '../../src/features/markets/ui/MarketBadge';
import { MarketCard } from '../../src/features/markets/ui/MarketCard';
import { MarketHero } from '../../src/features/markets/ui/MarketHero';

import { nearbyMarket } from './market-list-test-support';

import { tokens as allTokens } from './css-test-support';

const HERE = dirname(fileURLToPath(import.meta.url));
const WEB = join(HERE, '../..');
const LOGOS = join(WEB, 'public/img/market-logo');
const LOGO_URL = 'http://localhost:5173/img/market-logo/a101.svg';
const MAX_SVG_BYTES = 1024;

const badge = (logoUrl: string | undefined, size: 'card' | 'hero' = 'card') =>
  renderToStaticMarkup(createElement(MarketBadge, { brand: 'A101', logoUrl, size }));

describe('MarketBadge', () => {
  it('logo varsa: beyaz kutuda dekoratif <img alt="">, bas harf yok', () => {
    const html = badge(LOGO_URL);

    expect(html).toMatch(/class="[^"]*c-market-badge--card[^"]*c-market-badge--logo[^"]*"/);
    expect(html).toContain(`src="${LOGO_URL}"`);
    expect(html).toMatch(/<img[^>]*alt=""/);
    expect(html).not.toContain('>A<');
  });

  it('logo yoksa: bas harf rozeti (ekran okuyucudan gizli)', () => {
    const html = badge(undefined);

    expect(html).toMatch(
      /<span class="[^"]*c-market-badge--card[^"]*" aria-hidden="true">A<\/span>/,
    );
    expect(html).not.toContain('<img');
    expect(html).not.toContain('c-market-badge--logo');
  });

  it('liste karti ayni bileseni kart olcusuyle kullanir; eski sol alt rozet yok', () => {
    const market = {
      ...nearbyMarket({ id: 'mkt_a101', name: 'A101 – Caferağa', brand: 'A101', meters: 300 })
        .market,
      logoUrl: LOGO_URL,
    };
    const html = renderToStaticMarkup(
      createElement(
        MemoryRouter,
        null,
        createElement(MarketCard, {
          market,
          content: CONTENT_FALLBACK.marketList,
          nameLevel: 'h2',
        }),
      ),
    );

    expect(html).toMatch(/c-market-badge--card[^"]*c-market-badge--logo/);
    expect(html).toContain(`src="${LOGO_URL}"`);
    expect(html).not.toContain('c-market-card__badge');
  });

  it('magaza kapagi ayni bileseni hero olcusuyle kullanir', () => {
    const market = {
      ...nearbyMarket({ id: 'mkt_a101', name: 'A101 – Caferağa', brand: 'A101', meters: 300 })
        .market,
      logoUrl: LOGO_URL,
    };
    const html = renderToStaticMarkup(
      createElement(MarketHero, {
        market,
        pageTexts: CONTENT_FALLBACK.marketPage,
        listTexts: CONTENT_FALLBACK.marketList,
        onAbout: () => undefined,
      }),
    );

    expect(html).toMatch(/c-market-badge--hero[^"]*c-market-badge--logo/);
    expect(html).toContain(`src="${LOGO_URL}"`);
  });

  it('konum: sol ORTA, soldan yuzde token (4%); kare rozet ve logo ayni kural', () => {
    const css = readFileSync(join(WEB, 'src/features/markets/ui/MarketBadge.module.css'), 'utf8');
    const tokens = allTokens();
    const block = /\.c-market-badge \{([^}]*)\}/.exec(css)?.[1] ?? '';

    expect(block).toContain('inset-block-start: 50%;');
    expect(block).toContain('inset-inline-start: var(--inset-market-badge);');
    expect(block).toContain('transform: translateY(-50%);');
    expect(block).not.toMatch(/inset-block-end/);
    expect(tokens).toMatch(/--inset-market-badge: \d+%;/);
  });

  it('liste logosu: dar ekranda (kart dikey) %30, kart yatay olunca %40', () => {
    const css = readFileSync(join(WEB, 'src/features/markets/ui/MarketBadge.module.css'), 'utf8');
    const [base = '', wide = ''] = css.split('@media (--bp-md)');

    expect(base).toMatch(
      /\.c-market-badge--card\.c-market-badge--logo \{\s*inline-size: var\(--size-market-logo-narrow\);/,
    );
    expect(wide).toMatch(
      /\.c-market-badge--card\.c-market-badge--logo \{\s*inline-size: var\(--size-market-logo\);/,
    );
  });
});

describe('gecici yazi logolar (img/market-logo)', () => {
  const files = readdirSync(LOGOS).filter((name) => name.endsWith('.svg'));

  it('marka basina bir dosya (18)', () => {
    expect(files).toHaveLength(18);
  });

  it.each(files)(
    '%s: dekoratif ve guvenli (title, betik, dis baglanti yok), kucuk, tek renk',
    (name) => {
      const svg = readFileSync(join(LOGOS, name), 'utf8');

      expect(svg).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 200 100">/);
      expect(svg).not.toMatch(/<title|<script|href=|foreignObject|url\(|@import|on\w+=/i);
      expect(svg).toMatch(/fill="#[0-9A-F]{6}"/);
      expect(svg).toMatch(/<text [^>]*>[^<]+<\/text>/);
      expect(statSync(join(LOGOS, name)).size).toBeLessThan(MAX_SVG_BYTES);
    },
  );
});
