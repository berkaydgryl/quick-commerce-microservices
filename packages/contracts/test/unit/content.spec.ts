/**
 * Icerik sozlesmesi (T11.6): karsilama ekraninin metinleri ve gorselleri.
 */

import { describe, expect, it } from 'vitest';

import {
  CONTENT_FALLBACK,
  CONTENT_BANNER_SOURCES_MAX,
  CONTENT_FEATURES_MAX,
  CONTENT_PHONE_COUNTRIES_MAX,
  CONTENT_STORE_LINKS_MAX,
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

const STORE = {
  label: "App Store'dan indir",
  url: 'https://apps.apple.com/app/id995280265',
  badge: { url: `${ASSET}/img/store/app-store.svg`, width: 160, height: 48 },
};

/** Market listesi (T11.12): yedekle ayni metinler, gorseller mutlak adres. */
const MARKET_LIST = {
  ...CONTENT_FALLBACK.marketList,
  groups: CONTENT_FALLBACK.marketList.groups.map((group) => ({
    ...group,
    imageUrl: `${ASSET}${group.imageUrl}`,
  })),
};

const FEATURE = {
  image: { url: `${ASSET}/img/tanitim/teslimat.png`, width: 300, height: 300 },
  text: 'Siparişin dakikalar içinde kapında!',
};

const ADDRESS_SETUP = {
  title: 'Teslimat Adresi Ekle',
  backLabel: 'Geri',
  pinHint: "Adresini seçmek için Pin'i sürükle",
  searchLabel: 'Adres ara',
  searchPlaceholder: 'Sokağını veya posta kodunu arat',
  searchSubmitLabel: 'Ara',
  searchEmptyNotice: 'Sonuç bulunamadı.',
  useAddressLabel: 'Bu adresi kullan',
  resolvingLabel: 'Adres bulunuyor…',
  unresolvedNotice: 'Bu nokta için adres bulunamadı; adresini kendin yazabilirsin.',
  kindLabel: 'Adres türü',
  kinds: [
    { kind: 'HOME' as const, label: 'Ev', icon: '🏠' },
    { kind: 'WORK' as const, label: 'İş', icon: '🏢' },
    { kind: 'OTHER' as const, label: 'Diğer', icon: '📍' },
  ],
  titleLabel: 'Başlık (Ev, işyeri)',
  lineLabel: 'Adres',
  buildingLabel: 'Bina',
  floorLabel: 'Kat',
  apartmentLabel: 'Daire',
  noteLabel: 'Adres Tarifi',
  saveLabel: 'Kaydet',
  savingLabel: 'Kaydediliyor…',
  noMarketNotice: 'Bu adrese şu an hizmet veren market yok; yine de kaydedebilirsin.',
  map: {
    tileUrl: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '© OpenStreetMap katkıcıları',
    center: { lat: 40.9885, lng: 29.027 },
    zoom: 15,
  },
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
    phoneLabel: 'Telefon Numarası',
    continueLabel: 'Devam Et',
    closeLabel: 'Kapat',
    showPasswordLabel: 'Şifreyi göster',
    hidePasswordLabel: 'Şifreyi gizle',
    countries: [TURKIYE],
    login: {
      passwordLabel: 'Şifren',
      submitLabel: 'Giriş yap',
      pendingLabel: 'Giriş yapılıyor…',
      registerPrompt: 'Hesabın yok mu?',
      registerLinkLabel: 'Kayıt ol',
      unknownPhoneNotice: 'Bu numarayla kayıtlı bir hesap yok.',
    },
    register: {
      fullNameLabel: 'Adın soyadın',
      passwordLabel: 'Şifre belirle',
      submitLabel: 'Kayıt ol',
      pendingLabel: 'Kaydın oluşturuluyor…',
      loginPrompt: 'Zaten hesabın var mı?',
      loginLinkLabel: 'Giriş yap',
      knownPhoneNotice: 'Bu numarayla kayıtlı bir hesap var.',
    },
    forgotPasswordLabel: 'Şifremi unuttum',
    resetPassword: {
      title: 'Şifreni yenile',
      description: 'Hesabının telefon numarasını ve yeni şifreni yaz.',
      passwordLabel: 'Yeni şifre',
      submitLabel: 'Şifreyi değiştir',
      pendingLabel: 'Şifren değiştiriliyor…',
      loginPrompt: 'Şifreni hatırladın mı?',
      loginLinkLabel: 'Giriş yap',
    },
  },
  categories: { title: 'Kategoriler' },
  appDownload: {
    title: "Getir'i indir!",
    subtitle: 'İstediğin ürünleri dakikalar içinde kapına getirelim.',
    image: { url: `${ASSET}/img/landing/telefonlar.png`, width: 634, height: 298 },
    stores: [STORE],
  },
  features: [FEATURE],
  addressSetup: ADDRESS_SETUP,
  appHeader: {
    searchLabel: 'Market veya ürün ara',
    searchPlaceholder: 'Market veya ürün ara',
    searchClearLabel: 'Aramayı temizle',
    addressLabel: 'Teslimat adresi',
    addressListLabel: 'Kayıtlı adreslerin',
    addressBookTitle: 'Adreslerim',
    addressConfirmLabel: 'Adresi Onayla',
    addressAddPrompt: 'Başka bir adreste misin?',
    addressAddLabel: 'Adres Ekle',
    addressLoginLabel: 'Adres seçmek için giriş yap',
    noAddressNotice: 'Kayıtlı adresin yok.',
    addressLoadingLabel: 'Adreslerin yükleniyor…',
    profileLabel: 'Profil',
    accountLabel: 'Hesabım',
    logoutLabel: 'Çıkış yap',
    logoutPendingLabel: 'Çıkış yapılıyor…',
  },
  marketList: MARKET_LIST,
  favorites: CONTENT_FALLBACK.favorites,
  accountMenu: CONTENT_FALLBACK.accountMenu,
  profile: CONTENT_FALLBACK.profile,
  addresses: CONTENT_FALLBACK.addresses,
  orders: CONTENT_FALLBACK.orders,
  paymentMethods: CONTENT_FALLBACK.paymentMethods,
  marketPage: CONTENT_FALLBACK.marketPage,
  cartPage: CONTENT_FALLBACK.cartPage,
  footer: CONTENT_FALLBACK.footer,
  checkout: CONTENT_FALLBACK.checkout,
  confirm: CONTENT_FALLBACK.confirm,
  appLoading: CONTENT_FALLBACK.appLoading,
  courierTracking: CONTENT_FALLBACK.courierTracking,
};

const withMarketList = (marketList: Partial<WelcomeContent['marketList']>) => ({
  ...WELCOME,
  marketList: { ...MARKET_LIST, ...marketList },
});

const withAppDownload = (appDownload: Partial<WelcomeContent['appDownload']>) => ({
  ...WELCOME,
  appDownload: { ...WELCOME.appDownload, ...appDownload },
});

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

  it('magaza baglantisi yalnizca https olabilir (disari giden baglanti)', () => {
    const stores = [{ ...STORE, url: 'http://apps.apple.com/app/id995280265' }];
    expect(welcomeContentSchema.safeParse(withAppDownload({ stores })).success).toBe(false);
    const relative = [{ ...STORE, url: '/magaza' }];
    expect(welcomeContentSchema.safeParse(withAppDownload({ stores: relative })).success).toBe(
      false,
    );
  });

  it('rozetsiz ya da sinirdan kalabalik magaza listesini reddeder', () => {
    expect(welcomeContentSchema.safeParse(withAppDownload({ stores: [] })).success).toBe(false);
    const crowded = Array.from({ length: CONTENT_STORE_LINKS_MAX + 1 }, () => STORE);
    expect(welcomeContentSchema.safeParse(withAppDownload({ stores: crowded })).success).toBe(
      false,
    );
  });

  it('tanitim kutusu olmadan ya da sinirdan fazlasiyla reddeder', () => {
    expect(welcomeContentSchema.safeParse({ ...WELCOME, features: [] }).success).toBe(false);
    const crowded = Array.from({ length: CONTENT_FEATURES_MAX + 1 }, () => FEATURE);
    expect(welcomeContentSchema.safeParse({ ...WELCOME, features: crowded }).success).toBe(false);
  });

  it('gorselin dogal boyutu pozitif olmali (yer onceden ayrilir)', () => {
    const image = { ...WELCOME.appDownload.image, height: 0 };
    expect(welcomeContentSchema.safeParse(withAppDownload({ image })).success).toBe(false);
  });

  it('harita karosu https ve {z}/{x}/{y} tasimali (T11.8)', () => {
    const withTile = (tileUrl: string) => ({
      ...WELCOME,
      addressSetup: { ...ADDRESS_SETUP, map: { ...ADDRESS_SETUP.map, tileUrl } },
    });
    expect(
      welcomeContentSchema.safeParse(withTile('http://tile.openstreetmap.org/{z}/{x}/{y}.png'))
        .success,
    ).toBe(false);
    expect(
      welcomeContentSchema.safeParse(withTile('https://tile.openstreetmap.org/sabit.png')).success,
    ).toBe(false);
  });

  it('ayni adres turu iki kez yazilamaz (T11.8)', () => {
    const kinds = [ADDRESS_SETUP.kinds[0], ADDRESS_SETUP.kinds[0]];
    expect(
      welcomeContentSchema.safeParse({ ...WELCOME, addressSetup: { ...ADDRESS_SETUP, kinds } })
        .success,
    ).toBe(false);
  });
});

describe('marketList (T11.12)', () => {
  const [food, pet, flower] = MARKET_LIST.groups;

  it('gruplar ve tur adlari icerikten: her tur tam bir grupta, adi tam bir kez', () => {
    expect(welcomeContentSchema.safeParse(WELCOME).success).toBe(true);
  });

  it('gruba alinmamis tur reddedilir (menude gorunmeyen market olurdu)', () => {
    const groups = [food, pet].filter((group) => group !== undefined);
    expect(welcomeContentSchema.safeParse(withMarketList({ groups })).success).toBe(false);
  });

  it('iki gruba yazilmis tur reddedilir', () => {
    const groups = [
      food,
      pet,
      flower,
      { label: 'Tekrar', imageUrl: `${ASSET}/a.jpg`, types: ['KASAP' as const] },
    ].filter((group) => group !== undefined);
    expect(welcomeContentSchema.safeParse(withMarketList({ groups })).success).toBe(false);
  });

  it('adi eksik ya da iki kez yazilmis tur reddedilir', () => {
    const [first, ...rest] = MARKET_LIST.storeTypes;
    expect(welcomeContentSchema.safeParse(withMarketList({ storeTypes: rest })).success).toBe(
      false,
    );
    const doubled = first === undefined ? rest : [first, first, ...rest.slice(1)];
    expect(welcomeContentSchema.safeParse(withMarketList({ storeTypes: doubled })).success).toBe(
      false,
    );
  });

  it('grup gorseli mutlak adres olmali (gateway kurar)', () => {
    const groups = MARKET_LIST.groups.map((group) => ({
      ...group,
      imageUrl: '/img/market/market.jpg',
    }));
    expect(welcomeContentSchema.safeParse(withMarketList({ groups })).success).toBe(false);
  });

  it('bilinmeyen tur reddedilir', () => {
    const storeTypes = [{ type: 'BAKKAL', label: 'Bakkal' }, ...MARKET_LIST.storeTypes.slice(1)];
    const content = { ...WELCOME, marketList: { ...MARKET_LIST, storeTypes } };
    expect(welcomeContentSchema.safeParse(content).success).toBe(false);
  });
});
