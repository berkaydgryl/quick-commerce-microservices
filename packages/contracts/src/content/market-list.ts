/**
 * Market listesi ekrani (T11.12; R1, D18: content.ts'ten tasindi).
 */

import { z } from 'zod';

import { storeTypeSchema } from '../catalog.js';
import { contentImageUrlSchema } from './content-image-url.js';
import { contentTextSchema } from './content-text.js';

/** Dukkan turunun adi (T11.12): sol menude ve ciplerde "Kasap". */
export const storeTypeLabelSchema = z.object({
  type: storeTypeSchema,
  label: contentTextSchema,
});

/**
 * Sol menunun akordeon grubu (T11.12; referans getircarsi "Kategoriler"):
 * "Gida & Market" satiri acilinca o gruptaki turler sayilariyla listelenir.
 * Hangi turun hangi grupta oldugu icerikten gelir, kodda sabit degildir.
 */
export const storeTypeGroupSchema = z.object({
  label: contentTextSchema,
  /** Satirdaki kucuk gorsel; mutlak URL (gateway kurar). */
  imageUrl: contentImageUrlSchema,
  types: z.array(storeTypeSchema).min(1),
});

/** Sagdaki Sepetim paneli ve telefondaki sepet cubugu (T11.12). */
export const marketListCartContentSchema = z.object({
  title: contentTextSchema,
  emptyTitle: contentTextSchema,
  emptyHint: contentTextSchema,
  /** Urun sayisinin birimi: "3 ürün". */
  itemCountLabel: contentTextSchema,
  subtotalLabel: contentTextSchema,
  deliveryLabel: contentTextSchema,
  /** Teslimat ucreti 0 iken tutarin yerine. */
  freeDeliveryLabel: contentTextSchema,
  totalLabel: contentTextSchema,
  /** "Minimum sepet tutarına kalan: 25,10 TL". */
  minBasketRemainingLabel: contentTextSchema,
  /**
   * Kapali market (07.10 kullanici istegi): "+" pasif ve gri; sebep satiri magaza
   * sayfasinda, arama kartinda, sepet panelinde ve /sepet'te ("Market şu an kapalı").
   */
  closedNotice: contentTextSchema,
  goToCartLabel: contentTextSchema,
  clearLabel: contentTextSchema,
  /** Sepeti bosaltma onayi (T16.3): soru, alt not ve dugmeler; pencerenin basligi clearLabel. */
  clearConfirmQuestion: contentTextSchema,
  clearConfirmHint: contentTextSchema,
  clearConfirmLabel: contentTextSchema,
  cancelLabel: contentTextSchema,
  closeLabel: contentTextSchema,
  /** Adet dugmelerinin adi, urun adinin arkasina: "Saksıda Küçük Ağaç adedini azalt" (T16.3). */
  decreaseSuffix: contentTextSchema,
  increaseSuffix: contentTextSchema,
  removeSuffix: contentTextSchema,
  quantitySuffix: contentTextSchema,
});

/** Her tur tam bir kez: liste sozlesmedeki turlerle birebir. */
function coversEveryStoreTypeOnce(types: readonly string[]): boolean {
  return (
    types.length === storeTypeSchema.options.length &&
    storeTypeSchema.options.every((type) => types.includes(type))
  );
}

/**
 * Market listesi ekrani (T11.12; referans getircarsi "N isletme listeleniyor"):
 * solda dukkan turleri (gruplu, sayili), ortada market kartlari, sagda
 * Sepetim. Para ve sure bicimi istemcidedir; burada yalnizca etiketler.
 */
export const marketListContentSchema = z
  .object({
    categoriesTitle: contentTextSchema,
    /** Telefondaki ciplerin ilki: suzgec yok. */
    allLabel: contentTextSchema,
    /** Sayinin arkasi: "21 işletme listeleniyor". */
    countLabel: contentTextSchema,
    clearFilterLabel: contentTextSchema,
    loadingLabel: contentTextSchema,
    emptyNotice: contentTextSchema,
    /** Secili turde adrese hizmet veren market yok. */
    filterEmptyNotice: contentTextSchema,
    /** Puanin ve degerlendirme sayisinin erisilebilir adlari. */
    ratingLabel: contentTextSchema,
    ratingCountLabel: contentTextSchema,
    minBasketLabel: contentTextSchema,
    /** Esigin arkasi: "300,00 TL üzeri ücretsiz teslimat". */
    freeDeliveryThresholdLabel: contentTextSchema,
    closedLabel: contentTextSchema,
    storeTypes: z.array(storeTypeLabelSchema),
    groups: z.array(storeTypeGroupSchema).min(1),
    cart: marketListCartContentSchema,
  })
  .superRefine((content, context) => {
    if (!coversEveryStoreTypeOnce(content.storeTypes.map((option) => option.type))) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['storeTypes'],
        message: 'her dukkan turunun adi tam bir kez yazilmali',
      });
    }
    if (!coversEveryStoreTypeOnce(content.groups.flatMap((group) => group.types))) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['groups'],
        message: 'her dukkan turu tam bir gruba ait olmali',
      });
    }
  });

export type StoreTypeLabel = z.infer<typeof storeTypeLabelSchema>;

export type StoreTypeGroup = z.infer<typeof storeTypeGroupSchema>;

export type MarketListCartContent = z.infer<typeof marketListCartContentSchema>;

export type MarketListContent = z.infer<typeof marketListContentSchema>;
