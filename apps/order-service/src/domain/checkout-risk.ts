/**
 * Saga'nin risk adimi (T7.1): saf kurallar.
 *
 * Esikler ve bant hesabi risk-svc'dedir (domain/bands.ts). Burada yalnizca
 * banda gore SIPARISIN AKSIYONU var (roadmap "Bantlar ve aksiyonlar"):
 *   LOW      -> devam; kapida odeme acik
 *   MEDIUM   -> devam; kart + 3DS zorunlu, kapida odeme kapali
 *   HIGH     -> REVIEW (manuel inceleme kuyrugu), RISK_REVIEW
 *   CRITICAL -> REJECTED, RISK_BLOCKED
 */

import { AppError, ERROR_CODES, ORDER_STATUS, RISK_BANDS } from '@getir/core';
import type { Clock, ErrorCode, OrderStatus, RiskBand } from '@getir/core';

import { PAYMENT_METHOD } from './checkout-payment.js';
import type { PaymentMethod } from './checkout-payment.js';
import type { RiskHistory } from './order-history-reader.js';
import type { DeliveryLocation, Order } from './order.js';
import { TIMELINE_NOTE, transitionOrder } from './order.js';

/** proto int32 ust siniri: bekleme suresi bu alana sigmali (~24,8 gun). */
const INT32_MAX = 2_147_483_647;

/** Bandin odeme adimina getirdigi kural. */
export interface PaymentPolicy {
  readonly cashOnDeliveryAllowed: boolean;
  readonly requireThreeDs: boolean;
}

export type RiskDecision =
  | { readonly kind: 'proceed'; readonly policy: PaymentPolicy }
  | { readonly kind: 'stop'; readonly status: OrderStatus; readonly code: ErrorCode };

const LOW_RISK_POLICY: PaymentPolicy = { cashOnDeliveryAllowed: true, requireThreeDs: false };
const MEDIUM_RISK_POLICY: PaymentPolicy = { cashOnDeliveryAllowed: false, requireThreeDs: true };

export function decideRisk(band: RiskBand): RiskDecision {
  switch (band) {
    case RISK_BANDS.LOW:
      return { kind: 'proceed', policy: LOW_RISK_POLICY };
    case RISK_BANDS.MEDIUM:
      return { kind: 'proceed', policy: MEDIUM_RISK_POLICY };
    case RISK_BANDS.HIGH:
      return { kind: 'stop', status: ORDER_STATUS.REVIEW, code: ERROR_CODES.RISK_REVIEW };
    case RISK_BANDS.CRITICAL:
      return { kind: 'stop', status: ORDER_STATUS.REJECTED, code: ERROR_CODES.RISK_BLOCKED };
  }
}

/**
 * Odeme bekleyen siparisin politikasi, kayitli bandindan. Tekrar denemede
 * (cekim cevabi kayboldu) risk yeniden sorulmaz; ilk kararin kurali gecerli.
 *
 * @throws AppError ORDER_STATE_INVALID - bandsiz siparis: T7.1 oncesinde risk
 *   degerlendirmesiz odeme adimina gecmis eski kayit. Riski atlayarak cekim
 *   yapilmaz; kullanici yeni taslak acar.
 */
export function paymentPolicyOf(order: Order): PaymentPolicy {
  const decision = order.riskBand === undefined ? undefined : decideRisk(order.riskBand);
  if (decision?.kind !== 'proceed') {
    throw new AppError(ERROR_CODES.ORDER_STATE_INVALID, 'Siparisin risk degerlendirmesi yok', {
      details: { orderId: order.id, status: order.status },
    });
  }
  return decision.policy;
}

/** @throws AppError PAYMENT_METHOD_NOT_ALLOWED - kapida odeme bu bantta kapali. */
export function assertPaymentMethodAllowed(
  orderId: string,
  method: PaymentMethod,
  policy: PaymentPolicy,
): void {
  if (method === PAYMENT_METHOD.CASH_ON_DELIVERY && !policy.cashOnDeliveryAllowed) {
    throw new AppError(
      ERROR_CODES.PAYMENT_METHOD_NOT_ALLOWED,
      'Bu sipariste kapida odeme kullanilamaz',
      { details: { orderId, paymentMethod: method } },
    );
  }
}

/**
 * Risk kararini siparise isler: DRAFT -> RISK_CHECK (bant kaydedilir), sonra
 * durdurulduysa REVIEW / REJECTED (not: hata anahtari), gecerse
 * RESERVED (stok T11.2'de: not PENDING_RESERVATION) -> AWAITING_PAYMENT.
 */
export function applyRiskDecision(
  order: Order,
  band: RiskBand,
  decision: RiskDecision,
  clock: Clock,
): Order {
  const checked: Order = {
    ...transitionOrder(order, ORDER_STATUS.RISK_CHECK, clock),
    riskBand: band,
  };
  if (decision.kind === 'stop') {
    return transitionOrder(checked, decision.status, clock, decision.code);
  }
  const reserved = transitionOrder(
    checked,
    ORDER_STATUS.RESERVED,
    clock,
    TIMELINE_NOTE.PENDING_RESERVATION,
  );
  return transitionOrder(reserved, ORDER_STATUS.AWAITING_PAYMENT, clock);
}

/**
 * Gateway'in bildigi, istemcinin GONDEREMEDIGI risk sinyalleri (B9, T7.5).
 *
 * Hepsi istege bagli: gelmeyen sinyal ilgili risk kuralini tetiklemez (risk
 * sozlesmesi, "bos = yok"). T7.5'te gateway yalnizca IP'yi doldurur; digerleri
 * T8.1'de oturum ve kullanici kaydindan gelir. order-svc bunlari YORUMLAMAZ,
 * oldugu gibi risk-svc'ye tasir.
 */
export interface CheckoutSignals {
  readonly ipAddress?: string | undefined;
  readonly ipCity?: string | undefined;
  readonly deviceId?: string | undefined;
  /** Ayni cihazda gorulmus hesap sayisi; yoksa olculmedi. */
  readonly accountsOnDevice?: number | undefined;
  readonly previousIpAddress?: string | undefined;
  /** Oturumun acildigi konum (geofence); bicimi teslimat konumuyla ayni. */
  readonly sessionLocation?: DeliveryLocation | undefined;
  readonly accountCreatedAt?: Date | undefined;
}

/**
 * risk-svc'ye giden baglam: order'in bildigi alanlar ve gateway'den gelen
 * sinyaller. Eksik alan ilgili kurali tetiklemez (risk sozlesmesi).
 */
export interface OrderRiskContext {
  readonly userId: string;
  readonly orderId: string;
  readonly marketId: string;
  readonly deliveredOrderCount: number;
  readonly cancelledOrderCount: number;
  readonly basketTotalMinor: number;
  readonly currency: string;
  readonly userAverageBasketMinor?: number;
  /**
   * checkout-dwell: SUNUCUDA olculur (B9). Rezervasyon (T11.2) gelene kadar
   * baslangic taslagin acildigi an; T11.2'de reservedAt olur.
   */
  readonly checkoutDwellMs: number;
  readonly deliveryLocation: DeliveryLocation;
  /** Gateway'den gelen sinyaller (T7.5); order yorumlamaz, tasir. */
  readonly signals: CheckoutSignals;
}

export function riskContextOf(
  order: Order,
  history: RiskHistory,
  now: Date,
  signals: CheckoutSignals,
): OrderRiskContext {
  const dwellMs = Math.max(0, now.getTime() - order.createdAt.getTime());
  return {
    userId: order.userId,
    orderId: order.id,
    marketId: order.marketId,
    deliveredOrderCount: history.deliveredCount,
    cancelledOrderCount: history.cancelledCount,
    basketTotalMinor: order.pricing.totalMinor,
    currency: order.pricing.currency,
    ...(history.averageBasketMinor === undefined
      ? {}
      : { userAverageBasketMinor: history.averageBasketMinor }),
    checkoutDwellMs: Math.min(dwellMs, INT32_MAX),
    deliveryLocation: order.deliveryLocation,
    signals,
  };
}
