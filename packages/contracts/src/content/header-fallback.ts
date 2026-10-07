import type { AddressSetupContent } from './address-setup.js';
import type { AppHeaderContent } from './app-header.js';

/**
 * Ust barin yedegi (F21; 07.10 hatasi): icerik ucu hata verirse ya da gateway
 * ile web arasinda surum farki varsa arama kutusu, adres dugmesi ve adres
 * penceresi yine calisir; ekranda hata yerine bu metinler. Degerler
 * welcome.json ile AYNI (contracts testi karsilastirir).
 */
export const APP_HEADER_FALLBACK: AppHeaderContent = {
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
};

/** Adres penceresinin (harita, arama, form) yedegi: ust bar, sepet, odeme ve Adreslerim. */
export const ADDRESS_SETUP_FALLBACK: AddressSetupContent = {
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
    {
      kind: 'HOME',
      label: 'Ev',
      icon: '🏠',
    },
    {
      kind: 'WORK',
      label: 'İş',
      icon: '🏢',
    },
    {
      kind: 'OTHER',
      label: 'Diğer',
      icon: '📍',
    },
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
    center: {
      lat: 40.9885,
      lng: 29.027,
    },
    zoom: 15,
  },
};
