/**
 * Hesap sayfalarinin duzeni (T11.14 PR 2; referans getircarsi profil sayfasi):
 * Hesabim'da solda yalnizca menu, sagda kart; alt sekmede solda kart ve menu.
 * KURAL: her sekme ortak icerik kabina cizer; telefonda alt sekmenin ustunde
 * "Hesabım" geri baglantisi. Gorunum durumsuz; kap genisligi token'da
 * (tokens.css --size-account-content), CSS'te sekmeye ozel genislik yok.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { createElement } from 'react';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import { AccountLayoutView } from '../../src/pages/account/AccountLayoutView';
import type { AccountLayoutVariant } from '../../src/pages/account/AccountLayoutView';

import { tokens as allTokens } from './css-test-support';

const render = (element: ReactElement) =>
  renderToStaticMarkup(createElement(MemoryRouter, null, element));

const layout = (variant: AccountLayoutVariant) =>
  render(
    createElement(AccountLayoutView, {
      variant,
      title: 'Hesabım',
      accountHref: '/hesabim',
      card: createElement('p', null, 'KART'),
      menu: createElement('nav', null, 'MENU'),
      children: createElement('p', null, 'ICERIK'),
    }),
  );

/** Yan sutun ve icerik kabinin metni. */
function parts(markup: string) {
  const side = markup.slice(markup.indexOf('<aside'), markup.indexOf('</aside>'));
  const main = markup.slice(markup.indexOf('</aside>'));
  return { side, main };
}

describe('AccountLayoutView', () => {
  it('Hesabim (home): solda yalnizca menu; kap gorunmez h1 ve icerigi tasir', () => {
    const { side, main } = parts(layout('home'));

    expect(side).toContain('MENU');
    expect(side).not.toContain('KART');
    expect(main).toMatch(/<h1[^>]*c-account-layout__title[^>]*>Hesabım<\/h1>/);
    expect(main).toContain('ICERIK');
    expect(main).not.toContain('href="/hesabim"');
  });

  it('alt sekme (section): solda kart ve menu; kapta "Hesabım" geri baglantisi ve sekme', () => {
    const markup = layout('section');
    const { side, main } = parts(markup);

    expect(side.indexOf('KART')).toBeGreaterThanOrEqual(0);
    expect(side.indexOf('KART')).toBeLessThan(side.indexOf('MENU'));
    expect(main).toMatch(/<a[^>]*href="\/hesabim"[^>]*>.*Hesabım<\/a>/s);
    expect(main).toContain('ICERIK');
    expect(markup).toContain('c-account-layout--section');
    expect(main).not.toContain('<h1');
  });

  it('alt sayfa (nested): alt sekme duzeni, ama "Hesabım" geri baglantisi yok (T11.17)', () => {
    const markup = layout('nested');
    const { side, main } = parts(markup);

    expect(markup).toContain('c-account-layout--section');
    expect(side).toContain('KART');
    expect(main).not.toContain('href="/hesabim"');
    expect(main).toContain('ICERIK');
  });

  it('kap genisligi tek token: duzen iki sutunu yalnizca hesap tokenlariyla kurar', () => {
    const css = readFileSync(
      fileURLToPath(new URL('../../src/pages/account/AccountLayout.module.css', import.meta.url)),
      'utf8',
    );
    const tokens = allTokens();

    expect(css).toContain(
      'grid-template-columns: var(--size-account-side) minmax(0, var(--size-account-content));',
    );
    expect(tokens).toMatch(/--size-account-content: \d+(\.\d+)?rem;/);
    expect(tokens).toMatch(/--size-account-side: \d+(\.\d+)?rem;/);
  });
});
