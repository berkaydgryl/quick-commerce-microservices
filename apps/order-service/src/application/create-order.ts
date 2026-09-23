/**
 * Use-case: taslak siparisi odeme adimina getirir.
 *
 * DURUM MAKINESI (T4.4): siparis tablodaki yolu ADIM ADIM yurur:
 *   DRAFT -> RISK_CHECK -> RESERVED -> AWAITING_PAYMENT
 * T3.2 iskeleti DRAFT'tan dogrudan AWAITING_PAYMENT'a atliyordu; tablo zorunlu
 * olunca o kisayol ORDER_STATE_INVALID olur.
 *
 * GECICI ADIMLAR (bilerek ve gorunur): risk-svc (T6.3) ve stok rezervasyonu
 * (T11.2) henuz bagli degil. Bu iki adim bugun degerlendirmesiz/kilitsiz
 * gecer ve zaman cizelgesine NEDENIYLE yazilir (PENDING_RISK_SERVICE,
 * PENDING_RESERVATION) - sessizce atlanmaz. Saga geldiginde (T7.1, T11.2) bu
 * adimlarin yerini gercek cagrilar alir; tablo ve timeline degismez.
 * Odeme cekimi T7.1'dedir.
 */

import { AppError, ORDER_STATUS } from '@getir/core';
import type { Clock } from '@getir/core';

import type { OrderRepository } from '../domain/order-repository.js';
import type { Order } from '../domain/order.js';
import { TIMELINE_NOTE, transitionOrder } from '../domain/order.js';

export interface CreateOrderDeps {
  readonly repository: OrderRepository;
  readonly clock: Clock;
}

export interface CreateOrderInput {
  readonly orderId: string;
  readonly userId: string;
}

export type CreateOrder = (input: CreateOrderInput) => Promise<Order>;

export function createCreateOrder(deps: CreateOrderDeps): CreateOrder {
  return async ({ orderId, userId }) => {
    const order = await deps.repository.findById(orderId);

    // SAHIPLIK KONTROLU (sozlesme yorumu): baskasinin siparisi icin
    // PERMISSION_DENIED DEGIL, NOT_FOUND doneriz - "bu kimlikte bir siparis
    // var" bilgisi bile sizdirilmamalidir.
    if (order === null || order.userId !== userId) {
      throw AppError.notFound('Siparis bulunamadi', { details: { orderId } });
    }

    // Ilk gecis tablodan kontrol edilir: DRAFT disindaki bir siparis (ornegin
    // ikinci CreateOrder) burada ORDER_STATE_INVALID alir, hicbir sey yazilmaz.
    const riskChecked = transitionOrder(
      order,
      ORDER_STATUS.RISK_CHECK,
      deps.clock,
      TIMELINE_NOTE.PENDING_RISK_SERVICE,
    );
    const reserved = transitionOrder(
      riskChecked,
      ORDER_STATUS.RESERVED,
      deps.clock,
      TIMELINE_NOTE.PENDING_RESERVATION,
    );
    const awaitingPayment = transitionOrder(reserved, ORDER_STATUS.AWAITING_PAYMENT, deps.clock);

    await deps.repository.save(awaitingPayment);
    return awaitingPayment;
  };
}
