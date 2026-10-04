import type { MarketListContent } from './content.js';

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
} as const;

export type ContentFallback = typeof CONTENT_FALLBACK;
