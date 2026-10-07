/**
 * QA OQ1 (T15.2): saga DEGISMEZLERI. Ihlaller metin listesi olarak toplanir (bos = yesil); test
 * kirmizida tohum ve adim iziyle yazdirir (qa-order-saga-model.ts).
 *
 * Her adimdan sonra (stepViolations):
 *   G1 zaman cizelgesindeki her gecis durum makinesinin tablosunda;
 *   G2 inventory'de acik kilit (rezervasyon indeksinde) yalnizca DRAFT ya da AWAITING_PAYMENT'ta.
 * Kapanis turundan sonra (finalViolations):
 *   E1 gecis basina TAM bir order.status_changed, zaman cizelgesi sirasiyla, surum artar; tek
 *      order.created;
 *   E2 odeme asamasindan (AWAITING_PAYMENT, PAID) CANCELLED -> tek payment.cancel_requested;
 *   P1 PAID -> odeme SUCCEEDED (kart) ya da kapida odeme (PENDING) ve stok BIR kez kesin; PAID
 *      olmayan sipariste stok kesinlesmemis;
 *   P2 para: en fazla bir cekim, iade cekimi asmaz; cekilmis para ya PAID sipariste (iadesiz) ya
 *      iade edilmis (#164/#142 sinifi);
 *   P3 odenmemis siparisin odemesi acik kalmaz (PENDING, REQUIRES_3DS, SUCCEEDED yok);
 *   L1 hicbir siparisin kilidi acik kalmaz.
 */

import { EVENTS, ORDER_STATUS } from '@getir/core';
import type { OrderStatus } from '@getir/core';
import { reservationIndexKey } from '@getir/redis-kit';

import { PAYMENT_METHOD, PAYMENT_STATUS } from '../../../payment-service/src/domain/payment.js';
import { canTransition } from '../../src/domain/order-state-machine.js';
import type { Order } from '../../src/domain/order.js';
import { moneyIn } from './qa-money-checks.js';
import type { OrderCluster } from './qa-order-cluster.js';
import { eventCount, statusChanges } from './qa-order-stream.js';
import type { InventoryWorld } from './qa-payment-world.js';
import { MARKET } from './qa-payment-world.js';
import { LEDGER_KINDS } from '../../../inventory-service/src/domain/stock-ledger.js';
import { COLLECTIONS } from '../../../inventory-service/src/infrastructure/mongo/documents.js';
import type { StockLedgerDocument } from '../../../inventory-service/src/infrastructure/mongo/documents.js';

const LOCK_HOLDING: readonly OrderStatus[] = [ORDER_STATUS.DRAFT, ORDER_STATUS.AWAITING_PAYMENT];
const PAYMENT_STAGE: readonly OrderStatus[] = [ORDER_STATUS.AWAITING_PAYMENT, ORDER_STATUS.PAID];
const OPEN_PAYMENT: readonly string[] = [
  PAYMENT_STATUS.PENDING,
  PAYMENT_STATUS.REQUIRES_3DS,
  PAYMENT_STATUS.SUCCEEDED,
];

/** Siparislerin son hali (izlenen sirayla); kayit yoksa ihlal. */
export async function ordersOf(
  cluster: OrderCluster,
  orderIds: readonly string[],
  violations: string[],
): Promise<Order[]> {
  const orders: Order[] = [];
  for (const orderId of orderIds) {
    const order = await cluster.orders.findById(orderId);
    if (order === null) violations.push(`${orderId}: siparis kaydi yok`);
    else orders.push(order);
  }
  return orders;
}

/** inventory'de kilidi acik (rezervasyon indeksindeki) siparisler. */
async function openLocks(world: InventoryWorld): Promise<Set<string>> {
  return new Set(await world.stores.redis.redis.zrange(reservationIndexKey(MARKET), '0', '-1'));
}

/** G1 + G2: her adimdan sonra. */
export async function stepViolations(
  world: InventoryWorld,
  cluster: OrderCluster,
  orderIds: readonly string[],
): Promise<string[]> {
  const violations: string[] = [];
  const locks = await openLocks(world);
  for (const order of await ordersOf(cluster, orderIds, violations)) {
    const { timeline } = order;
    for (let index = 1; index < timeline.length; index += 1) {
      const from = timeline[index - 1]?.status;
      const to = timeline[index]?.status;
      if (from === undefined || to === undefined || !canTransition(from, to)) {
        violations.push(`G1 ${order.id}: tabloda olmayan gecis ${String(from)} -> ${String(to)}`);
      }
    }
    if (locks.has(order.id) && !LOCK_HOLDING.includes(order.status)) {
      violations.push(`G2 ${order.id}: ${order.status} durumunda kilit acik`);
    }
  }
  return violations;
}

/** Siparisin stok defterindeki kesinlesme (commit) kayitlari. */
async function commitsOf(world: InventoryWorld, orderId: string): Promise<number> {
  return world.stores.mongo.db
    .collection<StockLedgerDocument>(COLLECTIONS.STOCK_LEDGER)
    .countDocuments({ marketId: MARKET, orderId, kind: LEDGER_KINDS.COMMIT });
}

/** E1-E2, P1-P3, L1: kapanis turundan sonra. */
export async function finalViolations(
  world: InventoryWorld,
  cluster: OrderCluster,
  orderIds: readonly string[],
): Promise<string[]> {
  const violations: string[] = [];
  const locks = await openLocks(world);
  for (const order of await ordersOf(cluster, orderIds, violations)) {
    const report = (rule: string, message: string) =>
      violations.push(`${rule} ${order.id} (${order.status}): ${message}`);
    eventViolations(cluster, order, report);
    await moneyViolations(world, cluster, order, report);
    if (locks.has(order.id)) report('L1', 'kilit acik kaldi');
  }
  return violations;
}

type Report = (rule: string, message: string) => void;

function eventViolations(cluster: OrderCluster, order: Order, report: Report): void {
  const changes = statusChanges(cluster.stream, order.id);
  const expected = order.timeline.slice(1).map((entry) => entry.status);
  const seen = changes.map((change) => change.to);
  if (JSON.stringify(seen) !== JSON.stringify(expected)) {
    report('E1', `akis ${seen.join('>')} | zaman cizelgesi ${expected.join('>')}`);
  }
  const versions = changes.map((change) => change.version);
  if (versions.some((version, index) => index > 0 && version <= (versions[index - 1] ?? 0))) {
    report('E1', `surum artmiyor: ${versions.join(',')}`);
  }
  if ((versions.at(-1) ?? 0) > order.version) {
    report('E1', `akistaki surum ${String(versions.at(-1))} > kayit ${String(order.version)}`);
  }
  if (eventCount(cluster.stream, order.id, EVENTS.ORDER_CREATED) !== 1) {
    report('E1', 'order.created tek degil');
  }
  const fromPaymentStage = order.timeline.some(
    (entry, index) =>
      entry.status === ORDER_STATUS.CANCELLED &&
      PAYMENT_STAGE.includes(order.timeline[index - 1]?.status ?? ORDER_STATUS.DRAFT),
  );
  const commands = eventCount(cluster.stream, order.id, EVENTS.PAYMENT_CANCEL_REQUESTED);
  if (commands !== (fromPaymentStage ? 1 : 0)) {
    report(
      'E2',
      `payment.cancel_requested ${String(commands)} (odeme asamasindan iptal: ${String(fromPaymentStage)})`,
    );
  }
}

async function moneyViolations(
  world: InventoryWorld,
  cluster: OrderCluster,
  order: Order,
  report: Report,
): Promise<void> {
  const payment = await cluster.payments.findByOrderId(order.id);
  const money = moneyIn(payment);
  const commits = await commitsOf(world, order.id);
  const paid = order.status === ORDER_STATUS.PAID;
  if (paid) {
    const settled =
      payment?.status === PAYMENT_STATUS.SUCCEEDED ||
      (payment?.method === PAYMENT_METHOD.CASH_ON_DELIVERY &&
        payment.status === PAYMENT_STATUS.PENDING);
    if (!settled) report('P1', `odeme ${String(payment?.method)} ${String(payment?.status)}`);
    if (commits !== 1) report('P1', `stok kesinlesmesi ${String(commits)}`);
    if (money.refunded !== 0) report('P2', 'PAID sipariste iade');
  } else {
    if (commits !== 0) report('P1', `odenmemis sipariste stok kesinlesmesi ${String(commits)}`);
    if (money.charged !== money.refunded) {
      report('P2', `cekilen ${String(money.charged)}, iade ${String(money.refunded)}`);
    }
    if (payment !== null && OPEN_PAYMENT.includes(payment.status)) {
      report('P3', `odeme acik kaldi: ${payment.method} ${payment.status}`);
    }
  }
  if (money.charged > 1 || money.refunded > money.charged) {
    report('P2', `cekim ${String(money.charged)}, iade ${String(money.refunded)}`);
  }
}
