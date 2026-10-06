import type {
  AccountMenuContent,
  AddressesContent,
  FavoritesContent,
  MarketListContent,
  OrdersContent,
  ProfileContent,
} from './content.js';
import { PAYMENT_METHODS_FALLBACK } from './content/payment-methods-fallback.js';

/**
 * Market listesinin yedegi (T11.12): icerik gelmese de marketler, dukkan turu
 * menusu ve Sepetim gorunur. Grup gorselleri GORELI yoldur (web ayni kokten
 * yayinlar); icerik ucundan gelen hali mutlak adrestir.
 */
const MARKET_LIST_FALLBACK: MarketListContent = {
  categoriesTitle: 'Kategoriler',
  allLabel: 'Tümü',
  countLabel: 'işletme listeleniyor',
  clearFilterLabel: 'Filtreyi kaldır',
  loadingLabel: 'İşletmeler yükleniyor…',
  emptyNotice: 'Bölgende şu an hizmet veren işletme yok.',
  filterEmptyNotice: 'Bu kategoride şu an işletme yok.',
  ratingLabel: 'Puan',
  ratingCountLabel: 'değerlendirme',
  minBasketLabel: 'Min.',
  freeDeliveryThresholdLabel: 'üzeri ücretsiz teslimat',
  closedLabel: 'Kapalı',
  storeTypes: [
    { type: 'MARKET', label: 'Market' },
    { type: 'MANAV', label: 'Manav' },
    { type: 'KASAP', label: 'Kasap' },
    { type: 'SARKUTERI', label: 'Şarküteri' },
    { type: 'KURUYEMIS', label: 'Kuruyemiş' },
    { type: 'FIRIN', label: 'Fırın' },
    { type: 'PETSHOP', label: 'Pet Shop' },
    { type: 'CICEKCI', label: 'Çiçekçi' },
  ],
  groups: [
    {
      label: 'Gıda & Market',
      imageUrl: '/img/market/market.jpg',
      types: ['MARKET', 'MANAV', 'KASAP', 'SARKUTERI', 'KURUYEMIS', 'FIRIN'],
    },
    { label: 'Pet Shop', imageUrl: '/img/market/petshop.jpg', types: ['PETSHOP'] },
    { label: 'Çiçek & Hediye', imageUrl: '/img/market/cicekci.jpg', types: ['CICEKCI'] },
  ],
  cart: {
    title: 'Sepetim',
    emptyTitle: 'Sepetin şu an boş',
    emptyHint: 'Sipariş vermek için sepetine ürün ekle',
    itemCountLabel: 'ürün',
    subtotalLabel: 'Ara toplam',
    deliveryLabel: 'Teslimat',
    freeDeliveryLabel: 'Ücretsiz',
    totalLabel: 'Toplam',
    minBasketRemainingLabel: 'Minimum sepet tutarına kalan',
    goToCartLabel: 'Sepete git',
    clearLabel: 'Sepeti boşalt',
  },
};

/** Favori marketlerin yedegi (T11.13): kalp ve favori sayfasi icerik gelmese de calisir. */
const FAVORITES_FALLBACK: FavoritesContent = {
  title: 'Favori İşletmelerim',
  addLabel: 'Favorilere ekle',
  removeLabel: 'Favorilerden çıkar',
  loadingLabel: 'Favorilerin yükleniyor…',
  emptyTitle: 'Henüz favori işletmen yok',
  emptyHint: 'İşletme kartındaki kalbe dokunarak favorilerine ekleyebilirsin.',
  removedNotice: 'favorilerden çıkarıldı',
  updateFailedToast: 'Favori güncellenemedi, tekrar dene.',
  listFullToast: 'Favori listen dolu; yenisini eklemek için birini çıkar.',
  toastDismissLabel: 'Bildirimi kapat',
};

/**
 * Hesap menusunun yedegi (T11.16): icerik gelmese de oturumdaki kullanici
 * Profil menusunden ve sol menuden hesap sayfalarina gidebilir.
 */
const ACCOUNT_MENU_FALLBACK: AccountMenuContent = {
  label: 'Hesap menüsü',
  profileLabel: 'Profilim',
  addressesLabel: 'Adreslerim',
  favoritesLabel: 'Favori İşletmeler',
  ordersLabel: 'Geçmiş Siparişlerim',
  paymentMethodsLabel: 'Ödeme Yöntemlerim',
};

/** Profil kartinin ve pencerelerinin yedegi (T11.14): icerik gelmese de profil duzenlenebilir. */
const PROFILE_FALLBACK: ProfileContent = {
  phoneLabel: 'Telefon',
  emailLabel: 'E-posta',
  addEmailLabel: 'E-posta ekle',
  editProfileLabel: 'Profili düzenle',
  verifiedLabel: 'Doğrulandı',
  verifyPhoneLabel: 'Doğrula',
  loadingLabel: 'Bilgilerin yükleniyor…',
  editDialog: {
    title: 'Profili düzenle',
    closeLabel: 'Kapat',
    backLabel: 'Geri',
    nameLabel: 'Ad soyad',
    saveNameLabel: 'Kaydet',
    savingNameLabel: 'Kaydediliyor…',
    nameSavedToast: 'Adın güncellendi.',
    emailLabel: 'E-posta',
    phoneLabel: 'Telefon',
    emptyEmailLabel: 'E-posta adresin yok',
    changeLabel: 'Değiştir',
    addLabel: 'Ekle',
    verifyLabel: 'Doğrula',
  },
  emailDialog: {
    title: 'E-posta adresi',
    closeLabel: 'Kapat',
    emailDescription: 'Bu adrese 6 haneli bir doğrulama kodu göndereceğiz.',
    emailFieldLabel: 'E-posta adresi',
    sendLabel: 'Kod gönder',
    sendingLabel: 'Gönderiliyor…',
    codeSentToLabel: 'Doğrulama kodunu şu adrese gönderdik:',
    codeFieldLabel: 'Doğrulama kodu',
    verifyLabel: 'Doğrula',
    verifyingLabel: 'Doğrulanıyor…',
    expiresInLabel: 'Kodun geçerlilik süresi',
    expiredNotice: 'Kodun süresi doldu. Yeni kod isteyebilirsin.',
    resendLabel: 'Kodu yeniden gönder',
    resendWaitLabel: 'Yeni kodu isteyebilmen için',
    changeEmailLabel: 'E-posta adresini değiştir',
    verifiedToast: 'E-posta adresin doğrulandı.',
  },
  phoneDialog: {
    title: 'Telefon numarası',
    changeDescription:
      'Yeni numarana 6 haneli bir doğrulama kodu göndereceğiz. Değişikliği onaylamak için şifreni gir.',
    verifyDescription: 'Numarana 6 haneli bir doğrulama kodu göndereceğiz.',
    phoneFieldLabel: 'Yeni telefon numarası',
    passwordLabel: 'Şifren',
    showPasswordLabel: 'Şifreyi göster',
    hidePasswordLabel: 'Şifreyi gizle',
    sendLabel: 'Kod gönder',
    sendingLabel: 'Gönderiliyor…',
    codeSentToLabel: 'Doğrulama kodunu şu numaraya gönderdik:',
    codeFieldLabel: 'Doğrulama kodu',
    verifyLabel: 'Doğrula',
    verifyingLabel: 'Doğrulanıyor…',
    expiresInLabel: 'Kodun geçerlilik süresi',
    expiredNotice: 'Kodun süresi doldu. Yeni kod isteyebilirsin.',
    resendLabel: 'Kodu yeniden gönder',
    resendWaitLabel: 'Yeni kodu isteyebilmen için',
    changePhoneLabel: 'Başka bir numara gir',
    verifiedToast: 'Telefon numaran doğrulandı.',
    changedToast: 'Telefon numaran değişti. Diğer cihazlardaki oturumların kapatıldı.',
  },
};

/** Gecmis Siparislerim'in yedegi (T11.16): icerik gelmese de liste ve detay calisir. */
const ORDERS_FALLBACK: OrdersContent = {
  title: 'Geçmiş Siparişlerim',
  loadingLabel: 'Siparişlerin yükleniyor…',
  emptyNotice: 'Geçmiş siparişiniz bulunmamaktadır.',
  unknownMarketLabel: 'Market',
  completedLabel: 'Tamamlandı',
  inProgressLabel: 'Devam ediyor',
  cancelledLabel: 'İptal edildi',
  refundedLabel: 'Ücret iade edildi',
  notDeliveredLabel: 'Teslim edilmedi',
  moreLabel: 'Daha fazla göster',
  loadingMoreLabel: 'Yükleniyor…',
  dateLabel: 'Sipariş tarihi',
  addressLabel: 'Teslimat adresi',
  itemsTitle: 'Ürünler',
  subtotalLabel: 'Ara toplam',
  deliveryFeeLabel: 'Teslimat',
  freeDeliveryLabel: 'Ücretsiz',
  discountLabel: 'İndirim',
  totalLabel: 'Toplam',
};

/** Adreslerim sekmesinin yedegi (T11.15): icerik gelmese de liste ve eylemler calisir. */
const ADDRESSES_FALLBACK: AddressesContent = {
  title: 'Adreslerim',
  loadingLabel: 'Adreslerin yükleniyor…',
  emptyNotice: 'Kayıtlı adresin yok. Aşağıdan ekleyebilirsin.',
  selectedLabel: 'Seçili adres',
  editSuffix: 'adresini düzenle',
  deleteSuffix: 'adresini sil',
  addOptions: [
    { kind: 'HOME', label: 'Ev adresi ekle' },
    { kind: 'WORK', label: 'İş adresi ekle' },
    { kind: 'OTHER', label: 'Diğer adres ekle' },
  ],
  editTitle: 'Adresi Düzenle',
  deleteLabel: 'Adresi sil',
  confirmTitle: 'Adresi sil',
  confirmQuestionSuffix: 'adresini silmek istiyor musun?',
  confirmHint: 'Geçmiş siparişlerin bundan etkilenmez.',
  confirmLabel: 'Sil',
  deletingLabel: 'Siliniyor…',
  cancelLabel: 'Vazgeç',
  deletedToastSuffix: 'adresi silindi.',
  updatedToast: 'Adresin güncellendi.',
};

/**
 * Icerik yedegi (T11.10 duzeltmesi): GET /v1/content/welcome hata verirse
 * ust barin calismasi icin gereken en az metin. Oturumdaki kullanici icerik
 * gelmese de cikis yapabilmeli, Hesabim'a gidebilmeli ve yeniden deneyebilmeli.
 * T11.12'den beri market listesi de (marketList) yedekle calisir.
 *
 * Ekran metninin tek kaynagi icerik ucudur; bu sozluk yalnizca o uc
 * ulasilamazken kullanilir (errors.ts'teki hata sozlugu kalibi). Degerler
 * gateway'in welcome.json'daki karsiliklariyla AYNIDIR; contracts testi iki
 * yeri karsilastirir, biri degisip digeri unutulursa kirmizi olur.
 */
export const CONTENT_FALLBACK = {
  /** header.brand ve header.service: logonun iki parcasi. */
  brand: 'getir',
  service: 'market',
  /** header.loginLabel. */
  loginLabel: 'Giriş yap',
  /** appHeader.profileLabel, accountLabel, logoutLabel, logoutPendingLabel. */
  profileLabel: 'Profil',
  accountLabel: 'Hesabım',
  logoutLabel: 'Çıkış yap',
  logoutPendingLabel: 'Çıkış yapılıyor…',
  /** Icerigi yeniden isteyen dugme (icerikte karsiligi yok: icerik gelmeyince gorunur). */
  retryLabel: 'Tekrar dene',
  /** marketList: bloğun tamami (T11.12). */
  marketList: MARKET_LIST_FALLBACK,
  /** favorites: bloğun tamami (T11.13). */
  favorites: FAVORITES_FALLBACK,
  /** accountMenu: bloğun tamami (T11.16). */
  accountMenu: ACCOUNT_MENU_FALLBACK,
  /** profile: bloğun tamami (T11.14). */
  profile: PROFILE_FALLBACK,
  /** addresses: bloğun tamami (T11.15). */
  addresses: ADDRESSES_FALLBACK,
  /** orders: bloğun tamami (T11.16). */
  orders: ORDERS_FALLBACK,
  /** paymentMethods: bloğun tamami (T11.17). */
  paymentMethods: PAYMENT_METHODS_FALLBACK,
} as const;

export type ContentFallback = typeof CONTENT_FALLBACK;
