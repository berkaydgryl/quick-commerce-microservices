/**
 * Sepet sayfasi ve sayfa alt bilgisi (T16.3; referans getircarsi sepet sayfasi).
 */

import { z } from 'zod';

import { contentTextSchema } from './content-text.js';

/**
 * Sepet sayfasinin metinleri (T16.3; /sepet): baslik ve "Sepeti temizle",
 * adres karti, "Sepet Toplamı" karti ve ucretsiz teslimat notu, "Ödemeye Geç",
 * ust bardaki teslim suresi cipi ve bos sepetin bağlantısı. Onay penceresi,
 * adet kutusu, bos sepet ve minimum sepet metinleri sepet paneliyle ORTAKTIR
 * (marketList.cart); adresin parca etiketleri adres formundan (addressSetup).
 */
export const cartPageContentSchema = z.object({
  title: contentTextSchema,
  clearLabel: contentTextSchema,
  addressTitle: contentTextSchema,
  addressLoadingLabel: contentTextSchema,
  /** Kayitli adresi olmayan kullanici: adres ust bardaki dugmeden secilir. */
  noAddressNotice: contentTextSchema,
  totalsTitle: contentTextSchema,
  subtotalLabel: contentTextSchema,
  /** "Ücretsiz teslimata kalan: 49,50 TL". */
  freeDeliveryRemainingLabel: contentTextSchema,
  checkoutLabel: contentTextSchema,
  /** Ust bardaki teslim suresi cipi: gorunen kisaltma ("TVS") ve okunan adi. */
  deliveryTimeShortLabel: contentTextSchema,
  deliveryTimeLabel: contentTextSchema,
  /** Bos sepette marketlere donus baglantisi. */
  browseMarketsLabel: contentTextSchema,
});

/**
 * Sayfa alt bilgisi (T16.3; sepet ve odeme sayfalari): telif satiri. Sosyal
 * ikonlar ve bilgi baglantisi gercek adresler verilene kadar YOK (PM karari
 * L6: adressiz ikon ya da baglanti cizilmez).
 */
export const footerContentSchema = z.object({
  copyright: contentTextSchema,
});

export type CartPageContent = z.infer<typeof cartPageContentSchema>;
export type FooterContent = z.infer<typeof footerContentSchema>;
