/**
 * Odeme kaydinin 3DS dogrulamasi (#163 B1): siparis ayrintisi (GetOrder) sayfa
 * yenilense de bekleyen dogrulamayi surdurebilsin diye payment-svc'den okunur
 * (GetPayment). Order onu YORUMLAMAZ: acik/kapali karari ve kalan sure
 * gateway'in tek saatiyle verilir (contracts order-three-ds.ts).
 *
 * challengeId bir YETENEK JETONUDUR (oturumla birlikte kod girmeye yeter):
 * gunluge, hata ayrintisina ve metrik etiketine yazilmaz. Kod (OTP) hicbir
 * yerde yoktur.
 */

/** Bekleyen (acik, suresi dolmus ya da hakki bitmis) 3DS dogrulamasi. */
export interface ThreeDsStatus {
  /** Confirm3Ds jetonu; payment dogrulamayi kapali saydiginda bos gonderir. */
  readonly challengeId: string;
  /** Kodun gecerlilik bitisi (payment'in saati). */
  readonly expiresAt: Date;
  /** Kalan yanlis kod hakki; 0 = hakki bitti. */
  readonly attemptsLeft: number;
}

/** Odeme kaydinin 3DS okumasi: kaydin sahibi ve (varsa) dogrulama. */
export interface PaymentThreeDs {
  /** Kaydin sahibi; siparisin sahibiyle ayni degilse durum verilmez. */
  readonly userId: string;
  /** Dogrulama yoksa ya da odeme sonuclandiysa yok. */
  readonly threeDs?: ThreeDsStatus;
}
