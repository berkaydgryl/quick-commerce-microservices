/**
 * Sepet hesabinin girdi ve cikti tipleri. Tum tutarlar KURUS, tam sayi.
 */

/** Sepetin bir satiri: fiyat O MARKETIN teklifidir (ADR-15). */
export interface CartLine {
  readonly productId: string;
  /** Birim fiyat, kurus. */
  readonly unitPriceMinor: number;
  /**
   * Adet. Ust siniri (CART_ITEM_MAX_QUANTITY = 99) @getir/contracts
   * cartItemInputSchema sinirda uygular; burada tekrar DOGRULANMAZ ki iki
   * kaynak birbirinden ayrilmasin.
   */
  readonly quantity: number;
}

/**
 * Marketin sepet kurallari (ADR-15): market.pricingRules. Pricing bunlari
 * PARAMETRE olarak alir, sabit okumaz; market paneli geldiginde yalnizca
 * kaynak degisir.
 */
export interface PricingRules {
  readonly minBasketMinor: number;
  readonly deliveryFeeMinor: number;
  /** Ara toplam (indirim ONCESI, B12) buna ulasirsa teslimat ucretsizdir. */
  readonly freeDeliveryThresholdMinor: number;
}

/**
 * Kuponun karar icin ihtiyac duydugu bilgi. Pricing bunu SORGULAMAZ (I/O yok);
 * cagiran verir: order-service kendi kaydindan, web oturum bilgisinden.
 */
export interface PricingContext {
  readonly isFirstOrder: boolean;
}

/** Kuponun uygulanmama sebebi. Sunucu COUPON_INVALID'e, istemci mesaja cevirir. */
export type CouponRejection = 'UNKNOWN_CODE' | 'NOT_FIRST_ORDER' | 'BELOW_MIN_SUBTOTAL';

export type CouponOutcome =
  | { readonly code: string; readonly applied: true }
  | { readonly code: string; readonly applied: false; readonly reason: CouponRejection };

export interface CartInput {
  readonly lines: readonly CartLine[];
  readonly rules: PricingRules;
  readonly context: PricingContext;
  /** Kullanicinin girdigi kod; buyuk/kucuk harf ve bosluk onemsiz. */
  readonly couponCode?: string | undefined;
}

export interface CartTotals {
  readonly subtotalMinor: number;
  readonly discountMinor: number;
  readonly deliveryFeeMinor: number;
  /** max(0, ara toplam - indirim + teslimat). */
  readonly totalMinor: number;
  /** Sepet bos degil ve minimum sepete ulasildi. */
  readonly canCheckout: boolean;
  /** "Minimum sepete X TL kaldi"; ulasildiysa 0. */
  readonly amountToMinBasketMinor: number;
  /** "X TL daha ekle, teslimat ucretsiz"; teslimat zaten ucretsizse 0. */
  readonly amountToFreeDeliveryMinor: number;
  /** Kupon girildiyse sonucu; girilmediyse null. */
  readonly coupon: CouponOutcome | null;
}
