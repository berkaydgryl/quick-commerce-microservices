/**
 * Domain duzeyinde ornek taslak girdisi: fiyati dondurulmus kalem ve tutar.
 * Use-case ve depo testleri taslagi dogrudan domain'den kurar; tutarin
 * NASIL hesaplandigi price-draft testlerinin konusudur, burada sabit ornektir.
 */

import { RISK_BANDS } from '@getir/core';
import type { Clock, RiskBand } from '@getir/core';

import { applyRiskDecision, decideRisk } from '../../src/domain/checkout-risk.js';
import { orderCreatedEvents, statusChangedEvents } from '../../src/domain/order-events.js';

import { ITEM_UNIT } from '../../src/domain/order-item.js';
import type { OrderItem, OrderPricing } from '../../src/domain/order-item.js';
import type { OrderRepository } from '../../src/domain/order-repository.js';
import type { DraftOrderInput, Order } from '../../src/domain/order.js';
import { createDraftOrder } from '../../src/domain/order.js';

/** 2 x Sut 1 L (32,50 TL). */
export const SAMPLE_ITEM: OrderItem = {
  productId: 'prd_sut-1l',
  sku: 'SUT-1L',
  name: 'Süt 1 L',
  unit: ITEM_UNIT.LITER,
  quantity: 2,
  unitPriceMinor: 3_250,
  lineTotalMinor: 6_500,
};

/** 65,00 ara toplam + 14,90 teslimat = 79,90 TL. */
export const SAMPLE_PRICING: OrderPricing = {
  currency: 'TRY',
  subtotalMinor: 6_500,
  deliveryFeeMinor: 1_490,
  discountMinor: 0,
  totalMinor: 7_990,
};

export function sampleDraftInput(overrides: Partial<DraftOrderInput> = {}): DraftOrderInput {
  return {
    userId: 'usr_1',
    marketId: 'mkt_migros-jet-moda',
    items: [SAMPLE_ITEM],
    pricing: SAMPLE_PRICING,
    deliveryLocation: { lat: 40.9885, lng: 29.0262 },
    deliveryAddress: 'Caferağa, Kadıköy',
    ...overrides,
  };
}

/** Taslagi domain'den kurup depoya yazar: taslagin kendisini test ETMEYEN senaryolarin on kosulu. */
export async function insertDraft(
  repository: Pick<OrderRepository, 'insert'>,
  clock: Clock,
  overrides: Partial<DraftOrderInput> = {},
): Promise<Order> {
  const order = createDraftOrder(sampleDraftInput(overrides), clock);
  await repository.insert(order, orderCreatedEvents(order));
  return order;
}

/**
 * Risk adimindan gecmis, ODEME BEKLEYEN siparis yazar (T7.1): odeme adimini
 * ya da iptali test eden senaryolarin on kosulu. Bant verilmezse LOW.
 */
export async function insertAwaitingPayment(
  repository: Pick<OrderRepository, 'insert' | 'update'>,
  clock: Clock,
  band: RiskBand = RISK_BANDS.LOW,
): Promise<Order> {
  const draft = await insertDraft(repository, clock);
  const awaiting = applyRiskDecision(draft, band, decideRisk(band), clock);
  await repository.update(awaiting, draft.version, statusChangedEvents(draft, awaiting));
  return awaiting;
}
