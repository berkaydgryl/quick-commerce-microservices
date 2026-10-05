import { CONTENT_FALLBACK } from '@getir/contracts';
import { ERROR_CODES } from '@getir/core';
import { describe, expect, it, vi } from 'vitest';

import { fetchWelcomeContent } from '../../src/features/content/api/content.api';
import { createHttpClient } from '../../src/shared/api/http-client';

const ASSET = 'http://localhost:5173';

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

const welcome = {
  header: { brand: 'getir', service: 'market', loginLabel: 'Giriş yap', registerLabel: 'Kayıt ol' },
  hero: {
    title: 'Kapına gelen market: getirmarket',
    banner: {
      sources: [{ url: `${ASSET}/img/banner/kapina-gelen-market-960.jpg`, width: 960 }],
      width: 960,
      height: 277,
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
    countries: [
      { code: 'TR', name: 'Türkiye', dialCode: '+90', flagUrl: `${ASSET}/img/flag/tr.svg` },
    ],
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
      pendingLabel: 'Kaydın yapılıyor…',
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
    stores: [
      {
        label: "App Store'dan indir",
        url: 'https://apps.apple.com/app/id995280265',
        badge: { url: `${ASSET}/img/store/app-store.svg`, width: 160, height: 48 },
      },
    ],
  },
  features: [
    {
      image: { url: `${ASSET}/img/tanitim/teslimat.png`, width: 300, height: 300 },
      text: 'Siparişin dakikalar içinde kapında!',
    },
  ],
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
    favoritesLabel: 'Favori marketlerim',
    logoutLabel: 'Çıkış yap',
    logoutPendingLabel: 'Çıkış yapılıyor…',
  },
  marketList: {
    ...CONTENT_FALLBACK.marketList,
    groups: CONTENT_FALLBACK.marketList.groups.map((group) => ({
      ...group,
      imageUrl: `${ASSET}${group.imageUrl}`,
    })),
  },
  favorites: CONTENT_FALLBACK.favorites,
  profile: CONTENT_FALLBACK.profile,
  addresses: CONTENT_FALLBACK.addresses,
};

function clientReturning(body: unknown) {
  const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(body)));
  return { fetchMock, client: createHttpClient({ baseUrl: '', fetch: fetchMock }) };
}

describe('fetchWelcomeContent', () => {
  it('GET /v1/content/welcome cagirir ve icerigi sozlesmeyle dogrular', async () => {
    const { fetchMock, client } = clientReturning({ success: true, data: welcome });

    const content = await fetchWelcomeContent(client);

    expect(fetchMock.mock.calls[0]?.[0]).toBe('/v1/content/welcome');
    expect(content).toEqual(welcome);
  });

  it('bos metin sozlesme ihlalidir: ekranda bos dugme olmaz, INTERNAL', async () => {
    const { client } = clientReturning({
      success: true,
      data: { ...welcome, header: { ...welcome.header, loginLabel: '' } },
    });

    await expect(fetchWelcomeContent(client)).rejects.toMatchObject({
      code: ERROR_CODES.INTERNAL,
    });
  });
});
