/**
 * GetOrder'in 3DS adimi (#163 B1): odeme bekleyen siparisin bekleyen 3DS
 * dogrulamasini payment-svc'den okur; web sayfa yenilense de kodu kaldigi
 * yerden ister.
 *
 * - Yalnizca AWAITING_PAYMENT: baska durumda payment'a HIC gidilmez.
 * - Sahiplik bu adimdan ONCE denetlenmistir (findOwnOrder): baskasinin siparisi
 *   icin payment cagrilmaz.
 * - Siparis okumasini DUSURMEZ (karar Q2 a): payment'a ulasilamazsa, hata
 *   verirse ya da kaydin sahibi siparisinki degilse durum verilmez ve WARN
 *   yazilir. "Alan yok" web icin "bilinmiyor"dur; siparisi birakmaz, yoklar.
 *
 * Gunluk yalnizca siparis kimligini ve hata KODUNU tasir: jeton (challengeId)
 * yetenek jetonudur, hicbir satira girmez; hata nesnesi de yazilmaz (iceriginin
 * jeton tasimadigi denetlenemez).
 */

import { ERROR_CODES, isAppError, ORDER_STATUS } from '@getir/core';

import type { Order } from '../domain/order.js';
import type { PaymentThreeDs, ThreeDsStatus } from '../domain/payment-three-ds.js';
import type { Payments } from './payments.js';
import type { RequestScope } from './request-scope.js';

export async function pendingThreeDs(
  payments: Pick<Payments, 'getThreeDs'>,
  order: Order,
  scope: RequestScope,
): Promise<ThreeDsStatus | undefined> {
  if (order.status !== ORDER_STATUS.AWAITING_PAYMENT) {
    return undefined;
  }
  let payment: PaymentThreeDs | null;
  try {
    payment = await payments.getThreeDs(order.id, scope);
  } catch (error: unknown) {
    scope.logger.warn(
      { orderId: order.id, code: isAppError(error) ? error.code : ERROR_CODES.INTERNAL },
      '3DS durumu okunamadi; siparis 3DS durumsuz donuyor',
    );
    return undefined;
  }
  if (payment === null) {
    return undefined;
  }
  if (payment.userId !== order.userId) {
    scope.logger.warn(
      { orderId: order.id },
      'odeme kaydinin sahibi siparisin sahibi degil; 3DS durumu verilmedi',
    );
    return undefined;
  }
  return payment.threeDs;
}
