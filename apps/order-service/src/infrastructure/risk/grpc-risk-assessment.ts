/**
 * RiskAssessment portunun gRPC uygulamasi: order -> risk (T7.1).
 *
 * Tasima isi service-kit callUnary'dedir (requestId iletimi, sure siniri, hata
 * cevirisi); burasi yalnizca domain <-> proto cevirisini yapar.
 */

import { AppError, RISK_BANDS } from '@getir/core';
import type { RiskBand } from '@getir/core';
import { riskV1 } from '@getir/proto';
import { callUnary } from '@getir/service-kit';
import { credentials } from '@grpc/grpc-js';

import type { RequestScope } from '../../application/request-scope.js';
import type { RiskAssessment, RiskAssessmentResult } from '../../application/risk-assessment.js';
import type { CheckoutSignals, OrderRiskContext } from '../../domain/checkout-risk.js';

/**
 * Proto bandi -> core sozlugu. Record TUM enum degerlerini ister: proto'ya
 * bant eklenirse burasi DERLEMEDE kirilir. UNSPECIFIED/UNRECOGNIZED bilerek
 * undefined: bantsiz cevapla siparis ilerletilmez.
 */
const BAND_FROM_PROTO: Readonly<Record<riskV1.RiskBand, RiskBand | undefined>> = {
  [riskV1.RiskBand.RISK_BAND_UNSPECIFIED]: undefined,
  [riskV1.RiskBand.RISK_BAND_LOW]: RISK_BANDS.LOW,
  [riskV1.RiskBand.RISK_BAND_MEDIUM]: RISK_BANDS.MEDIUM,
  [riskV1.RiskBand.RISK_BAND_HIGH]: RISK_BANDS.HIGH,
  [riskV1.RiskBand.RISK_BAND_CRITICAL]: RISK_BANDS.CRITICAL,
  [riskV1.RiskBand.UNRECOGNIZED]: undefined,
};

export class GrpcRiskAssessment implements RiskAssessment {
  private readonly client: riskV1.RiskServiceClient;

  constructor(
    address: string,
    private readonly timeoutMs: number,
  ) {
    // TLS YOK: servisler yalnizca ic agda konusur (catalog istemcisiyle ayni karar).
    this.client = new riskV1.RiskServiceClient(address, credentials.createInsecure());
  }

  async evaluate(context: OrderRiskContext, scope: RequestScope): Promise<RiskAssessmentResult> {
    const response = await callUnary<riskV1.EvaluateRequest, riskV1.EvaluateResponse>(
      (request, metadata, options, callback) =>
        this.client.evaluate(request, metadata, options, callback),
      { context: toProtoContext(context) },
      { requestId: scope.requestId, timeoutMs: this.timeoutMs },
    );

    const evaluation = response.evaluation;
    const band = evaluation === undefined ? undefined : BAND_FROM_PROTO[evaluation.band];
    if (evaluation === undefined || band === undefined) {
      throw AppError.internal('Risk servisi bant dondurmedi', {
        details: { orderId: context.orderId },
      });
    }
    return { band, score: evaluation.score };
  }

  /** Kapanista cagrilir: acik HTTP/2 baglantisi process'i ayakta tutmasin. */
  close(): void {
    this.client.close();
  }
}

/**
 * Order'in bildigi alanlar + gateway'in sinyalleri (T7.5). Gelmeyen sinyal BOS
 * gider: risk sozlesmesinde bos alan "sinyal yok" demektir ve kurali tetiklemez.
 */
function toProtoContext(context: OrderRiskContext): riskV1.RiskContext {
  const money = (amountMinor: number) => ({ amountMinor, currency: context.currency });
  return riskV1.RiskContext.fromPartial({
    userId: context.userId,
    orderId: context.orderId,
    marketId: context.marketId,
    deliveredOrderCount: context.deliveredOrderCount,
    cancelledOrderCount: context.cancelledOrderCount,
    basketTotal: money(context.basketTotalMinor),
    ...(context.userAverageBasketMinor === undefined
      ? {}
      : { userAverageBasket: money(context.userAverageBasketMinor) }),
    checkoutDwellMs: context.checkoutDwellMs,
    deliveryLocation: { lat: context.deliveryLocation.lat, lng: context.deliveryLocation.lng },
    ...toProtoSignals(context.signals),
  });
}

/**
 * Sinyaller RiskContext'teki ayni adli alanlara gider. Mesaj alanlari (konum,
 * zaman) yalnizca varsa yazilir: gonderilmeyen mesaj "yok" demektir, bos bir
 * konum (0,0) ise gecerli bir nokta sayilirdi.
 */
function toProtoSignals(signals: CheckoutSignals): Partial<riskV1.RiskContext> {
  return {
    ipAddress: signals.ipAddress ?? '',
    ipCity: signals.ipCity ?? '',
    deviceId: signals.deviceId ?? '',
    accountsOnDevice: signals.accountsOnDevice ?? 0,
    previousIpAddress: signals.previousIpAddress ?? '',
    ...(signals.sessionLocation === undefined
      ? {}
      : {
          sessionLocation: { lat: signals.sessionLocation.lat, lng: signals.sessionLocation.lng },
        }),
    ...(signals.accountCreatedAt === undefined
      ? {}
      : { accountCreatedAt: signals.accountCreatedAt }),
  };
}
