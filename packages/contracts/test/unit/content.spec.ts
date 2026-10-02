/**
 * Icerik sozlesmesi (T11.6): karsilama ekraninin metinleri ve gorselleri.
 */

import { describe, expect, it } from 'vitest';

import {
  CONTENT_BANNER_SOURCES_MAX,
  CONTENT_PHONE_COUNTRIES_MAX,
  CONTENT_TEXT_MAX_LENGTH,
  welcomeContentSchema,
} from '../../src/index.js';
import type { WelcomeContent } from '../../src/index.js';

const ASSET = 'https://cdn.example.com';

const TURKIYE = {
  code: 'TR',
  name: 'Türkiye',
  dialCode: '+90',
  flagUrl: `${ASSET}/img/flag/tr.svg`,
};

const WELCOME: WelcomeContent = {
  header: { brand: 'getir', service: 'market', loginLabel: 'Giriş yap', registerLabel: 'Kayıt Ol' },
  hero: {
    title: 'Kapına gelen market: getirmarket',
    banner: {
      sources: [
        { url: `${ASSET}/img/banner/kapina-960.jpg`, width: 960 },
        { url: `${ASSET}/img/banner/kapina-1920.jpg`, width: 1920 },
      ],
      width: 1920,
      height: 555,
    },
  },
  loginCard: {
    title: 'Giriş yap veya kayıt ol',
    countryLabel: 'Ülke kodu',
    phoneLabel: 'Telefon numarası',
    phonePlaceholder: '5XX XXX XX XX',
    continueLabel: 'Devam Et',
    closeLabel: 'Kapat',
    showPasswordLabel: 'Şifreyi göster',
    countries: [TURKIYE],
    login: {
      passwordLabel: 'Şifren',
      submitLabel: 'Giriş yap',
      pendingLabel: 'Giriş yapılıyor…',
      registerPrompt: 'Hesabın yok mu?',
      registerLinkLabel: 'Kayıt ol',
    },
    register: {
      fullNameLabel: 'Adın soyadın',
      passwordLabel: 'Şifre belirle',
      submitLabel: 'Kayıt ol',
      pendingLabel: 'Kaydın oluşturuluyor…',
      loginPrompt: 'Zaten hesabın var mı?',
      loginLinkLabel: 'Giriş yap',
    },
  },
  categories: { title: 'Kategoriler' },
};

const withCard = (card: Partial<WelcomeContent['loginCard']>) => ({
  ...WELCOME,
  loginCard: { ...WELCOME.loginCard, ...card },
});

const withBanner = (banner: Partial<WelcomeContent['hero']['banner']>) => ({
  ...WELCOME,
  hero: { ...WELCOME.hero, banner: { ...WELCOME.hero.banner, ...banner } },
});

describe('welcomeContentSchema', () => {
  it('eksiksiz icerigi kabul eder', () => {
    expect(welcomeContentSchema.parse(WELCOME)).toEqual(WELCOME);
  });

  it('bos metni reddeder: ekranda bos baslik ya da dugme olmaz', () => {
    expect(welcomeContentSchema.safeParse({ ...WELCOME, categories: { title: '' } }).success).toBe(
      false,
    );
  });

  it('sinirdan uzun metni reddeder', () => {
    const long = 'a'.repeat(CONTENT_TEXT_MAX_LENGTH + 1);
    expect(welcomeContentSchema.safeParse(withCard({ title: long })).success).toBe(false);
    const limit = 'a'.repeat(CONTENT_TEXT_MAX_LENGTH);
    expect(welcomeContentSchema.safeParse(withCard({ title: limit })).success).toBe(true);
  });

  it('goreli gorsel yolunu reddeder: adresi gateway mutlak kurar', () => {
    const relative = withBanner({ sources: [{ url: '/img/banner/kapina-960.jpg', width: 960 }] });
    expect(welcomeContentSchema.safeParse(relative).success).toBe(false);
  });

  it('bannersiz ya da sinirdan fazla boylu banneri reddeder', () => {
    expect(welcomeContentSchema.safeParse(withBanner({ sources: [] })).success).toBe(false);
    const sources = Array.from({ length: CONTENT_BANNER_SOURCES_MAX + 1 }, (_, index) => ({
      url: `${ASSET}/img/banner/${index}.jpg`,
      width: 480 * (index + 1),
    }));
    expect(welcomeContentSchema.safeParse(withBanner({ sources })).success).toBe(false);
  });

  it('ayni genislikte iki boyu reddeder: srcset gecersiz olurdu', () => {
    const sources = [
      { url: `${ASSET}/img/banner/a.jpg`, width: 960 },
      { url: `${ASSET}/img/banner/b.jpg`, width: 960 },
    ];
    expect(welcomeContentSchema.safeParse(withBanner({ sources })).success).toBe(false);
  });

  it('ulkesiz, sinirdan kalabalik ya da tekrarli ulke listesini reddeder', () => {
    expect(welcomeContentSchema.safeParse(withCard({ countries: [] })).success).toBe(false);
    const crowded = Array.from({ length: CONTENT_PHONE_COUNTRIES_MAX + 1 }, () => TURKIYE);
    expect(welcomeContentSchema.safeParse(withCard({ countries: crowded })).success).toBe(false);
    expect(
      welcomeContentSchema.safeParse(withCard({ countries: [TURKIYE, TURKIYE] })).success,
    ).toBe(false);
  });

  it.each(['90', '+090', '+1234', '+9a'])('bicimsiz ulke kodunu reddeder: %s', (dialCode) => {
    const countries = [{ ...TURKIYE, dialCode }];
    expect(welcomeContentSchema.safeParse(withCard({ countries })).success).toBe(false);
  });

  it.each(['tr', 'TUR', 'T'])('ISO alfa-2 disindaki ulke kodunu reddeder: %s', (code) => {
    const countries = [{ ...TURKIYE, code }];
    expect(welcomeContentSchema.safeParse(withCard({ countries })).success).toBe(false);
  });
});
