import type { MarketPageContent } from './market-page.js';

/**
 * Magaza sayfasinin yedegi (T16.2): icerik gelmese de magaza, katalog ve
 * sepet dugmeleri calisir. Degerler welcome.json marketPage ile AYNIDIR.
 */
export const MARKET_PAGE_FALLBACK: MarketPageContent = {
  infoLabel: 'İşletme bilgisi',
  loadingLabel: 'İşletme yükleniyor…',
  openLabel: 'Açık',
  aboutLabel: 'Hakkında',
  closeLabel: 'Kapat',
  brandLabel: 'Marka',
  deliveryTimeLabel: 'Teslimat süresi',
  minBasketLabel: 'Minimum sepet tutarı',
  deliveryFeeLabel: 'Teslimat ücreti',
  freeDeliveryThresholdLabel: 'Ücretsiz teslimat eşiği',
  searchLabel: 'Bu işletmede ara',
  searchPlaceholder: 'Bu işletmede ara…',
  allProductsTitle: 'Tüm Ürünler',
  searchResultsTitle: 'Arama Sonuçları',
  searchEmptyNotice: 'Bu işletmede aradığın ürün bulunmuyor.',
  categoryEmptyNotice: 'Bu kategoride ürün yok.',
  productsLoadingLabel: 'Ürünler yükleniyor…',
  moreLabel: 'Daha fazla ürün',
  loadingMoreLabel: 'Yükleniyor…',
  addSuffix: 'sepete ekle',
  soldOutLabel: 'Tükendi',
  unavailableLabel: 'Satışta değil',
  lowStockPrefix: 'Son',
  lowStockSuffix: 'adet',
};
