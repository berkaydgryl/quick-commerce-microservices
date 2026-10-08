/**
 * Icerik yedegi (T11.10 duzeltmesi): yedek metinler gateway'in icerik
 * dosyasindaki karsiliklariyla ayni kalmali; ayrilirlarsa icerik gelmeyince
 * bar baska, gelince baska yazardi.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { CONTENT_FALLBACK, marketListContentSchema } from '../../src/index.js';

const WELCOME = JSON.parse(
  readFileSync(
    fileURLToPath(
      new URL('../../../../apps/gateway/internal/content/welcome.json', import.meta.url),
    ),
    'utf8',
  ),
) as {
  header: Record<string, string>;
  appHeader: Record<string, string>;
  addressSetup: unknown;
  loginCard: Record<string, unknown>;
  marketList: unknown;
  favorites: unknown;
  accountMenu: unknown;
  profile: unknown;
  addresses: unknown;
  orders: unknown;
  paymentMethods: unknown;
  marketPage: unknown;
  cartPage: unknown;
  footer: unknown;
  checkout: unknown;
  confirm: unknown;
  appLoading: unknown;
  courierTracking: unknown;
};

/** Yapidaki butun metinler (dizi ve ic nesneler dahil). */
function texts(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(texts);
  if (typeof value === 'object' && value !== null) return Object.values(value).flatMap(texts);
  return [];
}

describe('CONTENT_FALLBACK', () => {
  it('logo ve giris metni welcome.json header ile ayni', () => {
    expect(CONTENT_FALLBACK.brand).toBe(WELCOME.header['brand']);
    expect(CONTENT_FALLBACK.service).toBe(WELCOME.header['service']);
    expect(CONTENT_FALLBACK.loginLabel).toBe(WELCOME.header['loginLabel']);
  });

  it('Profil menusu metinleri welcome.json appHeader ile ayni', () => {
    for (const key of [
      'profileLabel',
      'accountLabel',
      'logoutLabel',
      'logoutPendingLabel',
    ] as const) {
      expect(CONTENT_FALLBACK[key], key).toBe(WELCOME.appHeader[key]);
    }
  });

  it('market listesi (T11.12) welcome.json marketList ile birebir: gruplar ve turler dahil', () => {
    expect(CONTENT_FALLBACK.marketList).toEqual(WELCOME.marketList);
  });

  it('favori metinleri (T11.13) welcome.json favorites ile birebir', () => {
    expect(CONTENT_FALLBACK.favorites).toEqual(WELCOME.favorites);
  });

  it('hesap menusu (T11.16) welcome.json accountMenu ile birebir: Profilim dahil', () => {
    expect(CONTENT_FALLBACK.accountMenu).toEqual(WELCOME.accountMenu);
  });

  it('profil metinleri (T11.14) welcome.json profile ile birebir', () => {
    expect(CONTENT_FALLBACK.profile).toEqual(WELCOME.profile);
  });

  it('Adreslerim metinleri (T11.15) welcome.json addresses ile birebir', () => {
    expect(CONTENT_FALLBACK.addresses).toEqual(WELCOME.addresses);
  });

  it('Odeme Yontemlerim metinleri (T11.17) welcome.json paymentMethods ile birebir', () => {
    expect(CONTENT_FALLBACK.paymentMethods).toEqual(WELCOME.paymentMethods);
  });

  it('Magaza sayfasi metinleri (T16.2) welcome.json marketPage ile birebir', () => {
    expect(CONTENT_FALLBACK.marketPage).toEqual(WELCOME.marketPage);
  });

  it('Sepet sayfasi ve alt bilgi metinleri (T16.3) welcome.json cartPage ve footer ile birebir', () => {
    expect(CONTENT_FALLBACK.cartPage).toEqual(WELCOME.cartPage);
    expect(CONTENT_FALLBACK.footer).toEqual(WELCOME.footer);
  });

  it('Odeme sayfasi metinleri (T17.1) welcome.json checkout ile birebir', () => {
    expect(CONTENT_FALLBACK.checkout).toEqual(WELCOME.checkout);
  });

  it('ortak onay penceresinin dugmeleri (F13) welcome.json confirm ile birebir', () => {
    expect(CONTENT_FALLBACK.confirm).toEqual(WELCOME.confirm);
  });

  it('Yukleniyor gostergesinin yazisi (F18) welcome.json appLoading ile birebir', () => {
    expect(CONTENT_FALLBACK.appLoading).toEqual(WELCOME.appLoading);
  });

  it('Gecmis Siparislerim metinleri (T11.16) welcome.json orders ile birebir', () => {
    expect(CONTENT_FALLBACK.orders).toEqual(WELCOME.orders);
  });

  it('kurye takibi metinleri (F22) welcome.json courierTracking ile birebir', () => {
    expect(CONTENT_FALLBACK.courierTracking).toEqual(WELCOME.courierTracking);
  });

  it('ust bar ve adres penceresi (F21): appHeader, addressSetup ve "Kapat" welcome.json ile ayni', () => {
    expect(CONTENT_FALLBACK.appHeader).toEqual(WELCOME.appHeader);
    expect(CONTENT_FALLBACK.addressSetup).toEqual(WELCOME.addressSetup);
    expect(CONTENT_FALLBACK.closeLabel).toBe(WELCOME.loginCard['closeLabel']);
  });

  it('yedegin market listesi sozlesmeden gecer (gorseller mutlak adrese cevrilince)', () => {
    const { marketList } = CONTENT_FALLBACK;
    const absolute = {
      ...marketList,
      groups: marketList.groups.map((group) => ({
        ...group,
        imageUrl: `https://cdn.example.com${group.imageUrl}`,
      })),
    };

    expect(marketListContentSchema.safeParse(absolute).success).toBe(true);
  });

  it('bos metin yok', () => {
    for (const text of texts(CONTENT_FALLBACK)) {
      expect(text.trim()).not.toBe('');
    }
  });
});
