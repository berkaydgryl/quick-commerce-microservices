/**
 * Puanlanacak baglam (proto RiskContext'in domain karsiligi).
 *
 * Alanlarin tamamini CAGIRAN TARAF (order/gateway) doldurur; risk-svc baska
 * servise sorgu atmaz. Risk sinyalleri ISTEMCIDEN alinmaz (B9): cihaz gecmisi,
 * IP/sehir, oturum konumu ve siparis sayilari sunucuda bilinir.
 *
 * Eksik alan ilgili kurali TETIKLEMEZ; hata degildir (proto sozlesmesi).
 */

export interface GeoPoint {
  readonly lat: number;
  readonly lng: number;
}

export interface RiskContext {
  readonly userId: string;
  readonly orderId?: string;
  readonly marketId?: string;
  /** account-age */
  readonly accountCreatedAt?: Date;
  /** order-history */
  readonly deliveredOrderCount?: number;
  readonly cancelledOrderCount?: number;
  /** basket-anomaly (kurus) */
  readonly basketTotalMinor?: number;
  readonly userAverageBasketMinor?: number;
  /** checkout-dwell: SUNUCUDA olculur. */
  readonly checkoutDwellMs?: number;
  /** geofence */
  readonly deliveryLocation?: GeoPoint;
  readonly sessionLocation?: GeoPoint;
  /** ip-device */
  readonly ipAddress?: string;
  readonly ipCity?: string;
  readonly deviceId?: string;
  readonly accountsOnDevice?: number;
  /** Bir onceki oturumun IP'si; yoksa ilk oturum ya da bilinmiyor. */
  readonly previousIpAddress?: string;
}
