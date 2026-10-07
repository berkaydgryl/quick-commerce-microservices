/**
 * Profil her sayfada ust barin en saginda (07.10 kullanici istegi): sade bar
 * (sepet, odeme) da tam barla ayni hesap yuvasini cizer (logo … adres, sayfanin
 * cipi, Profil); karsilama barinda oturum aciksa (adres kurulumu) "Giriş yap /
 * Kayıt ol" yerine Profil, oturumsuzken bugunku baglantilar. Karari sayfa verir:
 * hesap alanini YALNIZ adres kurulumu gecirir (headerAccount).
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement } from 'react';
import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import { AddressSetupPage } from '../../src/pages/address-setup/AddressSetupPage';
import { WelcomeHeader } from '../../src/pages/welcome/WelcomeHeader';
import { HeaderSlotContext } from '../../src/shared/ui/page-layout/header-slot';
import { PageLayout } from '../../src/shared/ui/page-layout/PageLayout';

const HEADER = {
  brand: 'getir',
  service: 'market',
  loginLabel: 'Giriş yap',
  registerLabel: 'Kayıt ol',
};
const SLOTS = {
  logo: createElement('span', null, 'LOGO'),
  search: createElement('span', null, 'ARAMA'),
  account: createElement('button', { type: 'button', 'aria-expanded': false }, 'Profil'),
  address: createElement('span', null, 'Ev'),
};

// Karsilama ekraninin icerigi (icerik ucu) burada gereksiz: yalniz bara gecen hesap alani.
vi.mock('../../src/pages/welcome/WelcomePage', () => ({
  WelcomePage: ({ headerAccount }: { readonly headerAccount?: ReactNode }) =>
    createElement('div', { 'data-bar': '' }, headerAccount),
}));

const render = (node: ReactNode) =>
  renderToStaticMarkup(
    createElement(
      MemoryRouter,
      null,
      createElement(
        QueryClientProvider,
        { client: new QueryClient() },
        createElement(HeaderSlotContext.Provider, { value: SLOTS }, node),
      ),
    ),
  );

/** Metindeki parcalarin sirasi: her biri bir oncekinden sonra gelir. */
const inOrder = (html: string, needles: readonly string[]) =>
  needles
    .map((needle) => html.indexOf(needle))
    .every((at, index, all) => at > (all[index - 1] ?? -1));

describe('sade bar (sepet, odeme)', () => {
  const minimal = () =>
    render(
      createElement(PageLayout, {
        variant: 'minimal',
        headerExtra: createElement('span', null, 'TVS 20-30 dk'),
        children: 'GOVDE',
      }),
    );

  it('Profil en sagda: logo, adres cipi, TVS, Profil (DOM ve odak sirasi)', () => {
    expect(inOrder(minimal(), ['LOGO', '>Ev<', 'TVS 20-30 dk', '>Profil<'])).toBe(true);
  });

  it('Profil tam barla AYNI yuvada (c-page-layout__actions); arama yok', () => {
    const html = minimal();

    expect(html).toMatch(/c-page-layout__actions[^"]*"><button[^>]*>Profil<\/button>/);
    expect(html).not.toContain('ARAMA');
  });
});

describe('karsilama bari', () => {
  it('oturumsuz: "Giriş yap" ve "Kayıt ol" (bugunku gibi), Profil yok', () => {
    const html = render(createElement(WelcomeHeader, { header: HEADER }));

    expect(html).toContain('Giriş yap');
    expect(html).toContain('Kayıt ol');
    expect(html).not.toContain('>Profil<');
  });

  it('oturum acik (adres kurulumu): Profil; "Giriş yap / Kayıt ol" YOK', () => {
    const html = render(createElement(WelcomeHeader, { header: HEADER, account: SLOTS.account }));

    expect(html).toContain('>Profil<');
    expect(html).not.toContain('Giriş yap');
    expect(html).not.toContain('Kayıt ol');
  });

  it('hesap alani null (yuva saglayicisi disinda): bos alan degil, baglantilar', () => {
    const html = render(createElement(WelcomeHeader, { header: HEADER, account: null }));

    expect(html).toContain('Giriş yap');
    expect(html).toContain('Kayıt ol');
  });
});

describe('karari sayfa verir', () => {
  it('adres kurulumu karsilama barina uygulamanin Profil yuvasini gecirir', () => {
    const html = render(createElement(AddressSetupPage, { userId: 'usr_1' }));

    expect(html).toMatch(/data-bar="">[\s\S]*>Profil<\/button>/);
  });

  it('hesap alanini YALNIZ adres kurulumu gecirir: oturumsuz sayfalar degismez', () => {
    const pages = join(__dirname, '../../src/pages');
    const passing = readdirSync(pages, { recursive: true, encoding: 'utf8' })
      .filter((file) => file.endsWith('.tsx'))
      .filter((file) => readFileSync(join(pages, file), 'utf8').includes('headerAccount={'));

    expect(passing).toEqual([join('address-setup', 'AddressSetupPage.tsx')]);
  });
});
