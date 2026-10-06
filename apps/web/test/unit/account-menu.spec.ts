/**
 * Hesap menusu (T11.16; kullanici istegi): profil sayfasinin sol menusu ve
 * ust barin Profil acilir menusu TEK listeden (accountMenuItems) cizilir; ikisi
 * ayni maddeleri ayni sirayla gosterir. Sira: Profilim, Adreslerim, Favori
 * İşletmeler, Geçmiş Siparişlerim, Ödeme Yöntemlerim (T11.17). Acilir menude "Çıkış yap" ayri satirda;
 * sol menude gecerli sayfa vurgulu, Profilim yalnizca /hesabim'de.
 */

import { CONTENT_FALLBACK } from '@getir/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement } from 'react';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AppHeaderAccount } from '../../src/app/AppHeader';
import { contentKeys } from '../../src/features/content/api/query-keys';
import { accountMenuLinks } from '../../src/pages/account/account-menu';
import { AccountMenu } from '../../src/pages/account/AccountMenu';
import {
  authenticatedSession,
  UNKNOWN_SESSION,
  useSessionStore,
} from '../../src/shared/session/session-store';
import type * as SessionStoreModule from '../../src/shared/session/session-store';
import type { SessionStore } from '../../src/shared/session/session-store';

import { sessionWith } from './session-test-support';

/**
 * Sunucu cizimi Zustand'in BASLANGIC durumunu okur (oturum "unknown": Profil
 * yerine yer tutucu). Test, deponun CANLI durumunu okuyan kancayla cizer;
 * depo (getState, setState) aynidir.
 */
vi.mock('../../src/shared/session/session-store', async (importOriginal) => {
  const actual = await importOriginal<typeof SessionStoreModule>();
  const store = actual.useSessionStore;
  const live = Object.assign(
    <T>(selector: (state: SessionStore) => T): T => selector(store.getState()),
    store,
  );
  return { ...actual, useSessionStore: live };
});

const TEXTS = CONTENT_FALLBACK.accountMenu;

const at = (path: string, element: ReactElement) =>
  renderToStaticMarkup(createElement(MemoryRouter, { initialEntries: [path] }, element));

/** Baglantilar, sirasiyla: [adres, etiket]. */
function links(markup: string): [string, string][] {
  return [...markup.matchAll(/<a[^>]*href="([^"]+)"[^>]*>([^<]*)<\/a>/g)].map((match) => [
    match[1] ?? '',
    match[2] ?? '',
  ]);
}

/** Sol menu: hesap sayfasinda, verilen adreste. */
const sideMenu = (path: string) => at(path, createElement(AccountMenu, { texts: TEXTS }));

/**
 * Ust barin Profil menusu, uygulamanin baglantisiyla (AppHeaderAccount):
 * oturum acik, icerik ucu hata vermis (metinler yedekten). Sunucu cizimi
 * acilir paneli de (hidden) basar.
 */
async function headerMenu(): Promise<string> {
  useSessionStore.setState(authenticatedSession(sessionWith('jeton')));
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, retryOnMount: false } },
  });
  await client.prefetchQuery({
    queryKey: contentKeys.welcome(),
    queryFn: () => Promise.reject(new Error('icerik yok')),
  });
  return at('/', createElement(QueryClientProvider, { client }, createElement(AppHeaderAccount)));
}

afterEach(() => {
  useSessionStore.setState(UNKNOWN_SESSION);
});

describe('hesap menusu (T11.16)', () => {
  it('tek liste: Profilim, Adreslerim, Favori İşletmeler, Geçmiş Siparişlerim, Ödeme Yöntemlerim', () => {
    expect(accountMenuLinks(TEXTS).map((link) => [link.href, link.label])).toEqual([
      ['/hesabim', 'Profilim'],
      ['/hesabim/adreslerim', 'Adreslerim'],
      ['/hesabim/favoriler', 'Favori İşletmeler'],
      ['/hesabim/siparislerim', 'Geçmiş Siparişlerim'],
      ['/hesabim/odeme-yontemlerim', 'Ödeme Yöntemlerim'],
    ]);
  });

  it('sol menu ve Profil acilir menusu ayni maddeleri ayni sirayla cizer', async () => {
    const side = links(sideMenu('/hesabim'));
    const header = links(await headerMenu());

    expect(side).toEqual(accountMenuLinks(TEXTS).map((link) => [link.href, link.label]));
    expect(header).toEqual(side);
  });

  it('acilir menude "Çıkış yap" maddelerin altinda ayri satirda', async () => {
    const markup = await headerMenu();
    const listEnd = markup.indexOf('</ul>');
    const logout = markup.indexOf(CONTENT_FALLBACK.logoutLabel);

    expect(listEnd).toBeGreaterThan(0);
    expect(logout).toBeGreaterThan(listEnd);
    expect(markup.slice(listEnd, logout)).toContain('c-header-account__logout');
  });

  it('sol menude gecerli sayfa vurgulu; Profilim yalnizca /hesabim de', () => {
    const active = (markup: string) =>
      [...markup.matchAll(/<a[^>]*class="[^"]*is-active[^"]*"[^>]*>([^<]*)<\/a>/g)].map(
        (match) => match[1],
      );

    expect(active(sideMenu('/hesabim'))).toEqual([TEXTS.profileLabel]);
    expect(active(sideMenu('/hesabim/adreslerim'))).toEqual([TEXTS.addressesLabel]);
    expect(active(sideMenu('/hesabim/siparislerim/ord_1'))).toEqual([TEXTS.ordersLabel]);
    expect(active(sideMenu('/hesabim/odeme-yontemlerim/ekle'))).toEqual([
      TEXTS.paymentMethodsLabel,
    ]);
  });

  it('sol menunun erisilebilir adi icerikten', () => {
    expect(sideMenu('/hesabim')).toContain(`aria-label="${TEXTS.label}"`);
  });
});
