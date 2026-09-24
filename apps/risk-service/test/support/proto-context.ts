/**
 * Domain baglamini proto RiskContext'e cevirir (testler icin): bir cagiranin
 * gonderecegi mesaj. Domain'de olmayan alan proto varsayilanina (0 / "")
 * duser; boylece "0 mi, yok mu?" sozlesmesi gercek telden sinanir.
 */

import { riskV1 } from '@getir/proto';

import type { RiskContext } from '../../src/domain/risk-context.js';

export function toProtoContext(context: RiskContext): riskV1.RiskContext {
  return {
    ...riskV1.RiskContext.fromPartial({}),
    userId: context.userId,
    orderId: context.orderId ?? '',
    marketId: context.marketId ?? '',
    accountCreatedAt: context.accountCreatedAt,
    deliveredOrderCount: context.deliveredOrderCount ?? 0,
    cancelledOrderCount: context.cancelledOrderCount ?? 0,
    basketTotal:
      context.basketTotalMinor === undefined
        ? undefined
        : { amountMinor: context.basketTotalMinor, currency: 'TRY' },
    userAverageBasket:
      context.userAverageBasketMinor === undefined
        ? undefined
        : { amountMinor: context.userAverageBasketMinor, currency: 'TRY' },
    checkoutDwellMs: context.checkoutDwellMs ?? 0,
    deliveryLocation: context.deliveryLocation,
    sessionLocation: context.sessionLocation,
    ipAddress: context.ipAddress ?? '',
    ipCity: context.ipCity ?? '',
    deviceId: context.deviceId ?? '',
    accountsOnDevice: context.accountsOnDevice ?? 0,
    previousIpAddress: context.previousIpAddress ?? '',
  };
}
