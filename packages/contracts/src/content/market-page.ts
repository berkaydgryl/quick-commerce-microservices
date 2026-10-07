/**
 * Magaza sayfasi (T16.2; referans getircarsi isletme sayfasi).
 */

import { z } from 'zod';

import { contentTextSchema } from './content-text.js';

/**
 * Magaza sayfasinin metinleri (T16.2): bilgi karti ve "Hakkında" penceresi,
 * "Bu işletmede ara…", katalog basliklari ve bos durumlari, urun kartinin sepet
 * dugmesi. Puan, "Min.", "Kapalı", ucretsiz teslimat esigi, "Kategoriler",
 * "Tümü" ve sepet metinleri market listesiyle ORTAKTIR (marketList); burada
 * tekrar edilmez. `*Suffix` metinleri urunun adinin arkasina eklenir.
 */
export const marketPageContentSchema = z.object({
  /** Bilgi kartinin erisilebilir adi: "İşletme bilgisi". */
  infoLabel: contentTextSchema,
  loadingLabel: contentTextSchema,
  /** Acik magazanin durumu; kapali magazada marketList.closedLabel. */
  openLabel: contentTextSchema,
  /** "Hakkında" baglantisi ve penceresinin basligi. */
  aboutLabel: contentTextSchema,
  closeLabel: contentTextSchema,
  /** Pencerenin satirlari: marka, sure, minimum sepet, teslimat ucreti, ucretsiz teslimat esigi. */
  brandLabel: contentTextSchema,
  deliveryTimeLabel: contentTextSchema,
  minBasketLabel: contentTextSchema,
  deliveryFeeLabel: contentTextSchema,
  freeDeliveryThresholdLabel: contentTextSchema,
  /** Arama kutusunun erisilebilir adi ve ipucu: "Bu işletmede ara…". */
  searchLabel: contentTextSchema,
  searchPlaceholder: contentTextSchema,
  /** Izgaranin basligi: kategori secili degilken / arama varken. */
  allProductsTitle: contentTextSchema,
  searchResultsTitle: contentTextSchema,
  searchEmptyNotice: contentTextSchema,
  categoryEmptyNotice: contentTextSchema,
  productsLoadingLabel: contentTextSchema,
  moreLabel: contentTextSchema,
  loadingMoreLabel: contentTextSchema,
  /** Urun kartinin "+"si: "Beyaz Peynir 500 g sepete ekle". */
  addSuffix: contentTextSchema,
  /** Stogu biten (T8.4) ve satista olmayan (T7.6) teklif. */
  soldOutLabel: contentTextSchema,
  unavailableLabel: contentTextSchema,
});

export type MarketPageContent = z.infer<typeof marketPageContentSchema>;
