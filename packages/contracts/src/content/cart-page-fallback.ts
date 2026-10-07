import type { CartPageContent, FooterContent } from './cart-page.js';

/**
 * Sepet sayfasinin ve alt bilginin yedegi (T16.3): icerik gelmese de sepet
 * gorunur, duzenlenir ve temizlenir. Degerler welcome.json ile AYNIDIR.
 */
export const CART_PAGE_FALLBACK: CartPageContent = {
  title: 'Sepetim',
  clearLabel: 'Sepeti temizle',
  addressTitle: 'Adres',
  addressLoadingLabel: 'Adresin yükleniyor…',
  noAddressNotice: 'Kayıtlı adresin yok; üstteki adres düğmesinden ekleyebilirsin.',
  totalsTitle: 'Sepet Toplamı',
  subtotalLabel: 'Sepet Tutarı',
  freeDeliveryRemainingLabel: 'Ücretsiz teslimata kalan',
  checkoutLabel: 'Ödemeye Geç',
  deliveryTimeShortLabel: 'TVS',
  deliveryTimeLabel: 'Tahmini varış süresi',
  browseMarketsLabel: 'Marketlere göz at',
};

export const FOOTER_FALLBACK: FooterContent = {
  copyright: '© 2026 getir',
};
