/**
 * QA kara kutu (D17; bekleyen is 123): devre kesici kablolamasi order'in GERCEK surecinde
 * (main.ts). Birim tablo (qa-breaker-wiring.spec) istemcilerin devreyi kullandigini kanitlar;
 * burada uretimdeki baglama: main her bagimliya kendi etiketiyle bir devre kurdu mu, devre o
 * bagimlinin cagrilarini kesiyor mu (qa-dependency-world.ts).
 *
 *   P0 acilista /metrics'te bes hedefin devresi var ve KAPALI.
 *   P1 catalog: taslak, catalog duserken; esikten sonra catalog'a cagri GITMEZ, devre{catalog}
 *      ACIK, reddedilen sayac artar; digerleri KAPALI (dogru etiket).
 *   P2 inventory: catalog saglam, Reserve duser.
 *   P3 risk: ayni taslakta CreateOrder (Evaluate tekrar edilmez).
 *   P4 payment: CreateOrder'da Charge duser.
 *   P5 courier: odenmis siparisi (3DS onayli) dagitici atar; Assign duser; sabit uyku yok,
 *      devrenin acilmasi metrik yoklanarak beklenir.
 *
 * Her senaryo kendi order surecini acar: bir senaryonun actigi devre (10 sn) digerine tasinmasin.
 */

import { ERROR_CODES } from '@getir/core';
import { orderV1, paymentV1 } from '@getir/proto';
import { appErrorOf } from '@getir/service-kit/testing';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { waitUntil } from '../../../inventory-service/test/support/qa-inventory-process.js';
import { DEPENDENCY } from '../../src/infrastructure/grpc-resilience.js';
import type { Dependency } from '../../src/infrastructure/grpc-resilience.js';
import {
  confirmPaymentRequest,
  createOrderRequest,
  draftRequest,
} from '../support/order-fixtures.js';
import {
  BREAKER,
  orderService,
  startOrder,
  useDependencies,
} from '../support/qa-dependency-world.js';
import type { OrderProcess } from '../support/qa-dependency-world.js';
import { UNAVAILABLE } from '../support/qa-grpc-faults.js';
import type { FaultyServer } from '../support/qa-grpc-faults.js';

const dependencies = useDependencies();
const TARGETS: readonly Dependency[] = Object.values(DEPENDENCY);
/** Demo katalogunda Migros Jet Moda'nin sutu (catalog fixtures). */
const LINE = { productId: 'prd_sut-1l', sku: 'SUT-1L', quantity: 2 };
/** Esigi asmak icin en cok bu kadar cagri (5 ariza; tekrar etmeyen cagrida 5 cagri). */
const MAX_TRIP_CALLS = 8;
/** Dagitici turu 1 sn (COURIER_DISPATCH_INTERVAL_MS): devrenin acilmasi icin bol butce. */
const DISPATCH_BUDGET_MS = 20_000;
const TEST_TIMEOUT_MS = 60_000;
let userCounter = 0;

function nextUser(): string {
  userCounter += 1;
  return `usr_${(0xd170 + userCounter).toString(16).padStart(32, '0')}`;
}

function draft(order: OrderProcess, userId: string, expectedTotalMinor: number) {
  return order.call(orderService.createDraftOrder, {
    ...draftRequest,
    userId,
    lines: [LINE],
    expectedTotal: { amountMinor: expectedTotalMinor, currency: 'TRY' },
  });
}

const priceChangedDetails = z.object({ totalMinor: z.number().int() });

/** Sepetin toplami: 0 ile istenir, order PRICE_CHANGED ayrintisinda gercek toplami soyler. */
async function totalOf(order: OrderProcess, userId: string): Promise<number> {
  const { error } = await draft(order, userId, 0);
  const details = priceChangedDetails.safeParse(appErrorOf(error)?.details);
  if (!details.success) throw new Error(`toplam okunamadi: ${error?.message ?? 'cevap var'}`);
  return details.data.totalMinor;
}

async function openDraft(order: OrderProcess, userId: string): Promise<string> {
  const { response, error } = await draft(order, userId, await totalOf(order, userId));
  if (response === undefined) throw new Error(`taslak acilamadi: ${error?.message ?? ''}`);
  return response.orderId;
}

function createOrder(order: OrderProcess, orderId: string, userId: string) {
  return order.call(
    orderService.createOrder,
    createOrderRequest(orderId, {
      userId,
      cardToken: 'tok_test_4242',
      paymentMethod: paymentV1.PaymentMethod.PAYMENT_METHOD_CARD,
    }),
  );
}

/**
 * Siparisi odenmis hale getirir. Risk bandi 3DS isterse (yeni kullanici: MEDIUM) mock koduyla
 * onaylanir; konu odeme degil dagitici oldugu icin sonda PAID beklenir.
 */
async function payOrder(order: OrderProcess, orderId: string, userId: string): Promise<void> {
  const created = await createOrder(order, orderId, userId);
  const challengeId = created.response?.challengeId ?? '';
  const paid =
    challengeId === ''
      ? created
      : await order.call(
          orderService.confirmPayment,
          confirmPaymentRequest(orderId, challengeId, { userId }),
        );
  expect({ error: paid.error, status: paid.response?.status }).toEqual({
    error: undefined,
    status: orderV1.OrderStatus.ORDER_STATUS_PAID,
  });
}

/**
 * Bagimli duserken cagri tekrarlanir; bir cagri bagimliya HIC ulasmadiginda durur (devre acik).
 * Ulasilamaz hata order'da SERVICE_UNAVAILABLE olur.
 */
async function callUntilBlocked(
  dependency: FaultyServer,
  invoke: () => Promise<{ readonly error?: Error | undefined }>,
): Promise<void> {
  for (let n = 0; n < MAX_TRIP_CALLS; n += 1) {
    const before = dependency.faults.calls();
    const { error } = await invoke();
    expect(appErrorOf(error)?.code).toBe(ERROR_CODES.SERVICE_UNAVAILABLE);
    if (dependency.faults.calls() === before) return;
  }
  throw new Error(`${MAX_TRIP_CALLS} cagride devre acilmadi (cagri hep bagimliya ulasti)`);
}

/** Yalnizca `open` hedefinin devresi ACIK ve reddetti; digerleri KAPALI (dogru etiket). */
async function expectOnlyOpen(order: OrderProcess, open: Dependency): Promise<void> {
  const breakers = await order.breakers();
  for (const target of TARGETS) {
    expect({ target, state: breakers[target]?.state }).toEqual({
      target,
      state: target === open ? BREAKER.OPEN : BREAKER.CLOSED,
    });
  }
  expect(breakers[open]?.rejected ?? 0).toBeGreaterThan(0);
}

describe('QA D17 devre kesici kablolamasi gercek order surecinde (main.ts)', () => {
  it('P0 acilista bes bagimlinin devresi var ve KAPALI', async () => {
    const order = await startOrder(dependencies());

    const breakers = await order.breakers();

    for (const target of TARGETS) {
      expect({ target, state: breakers[target]?.state }).toEqual({ target, state: BREAKER.CLOSED });
    }
  });

  it(
    'P1 catalog duser: esikten sonra taslak catalog a gitmez; yalniz devre{catalog} acik',
    async () => {
      const deps = dependencies();
      const order = await startOrder(deps);
      deps.catalog.faults.setAll(UNAVAILABLE);
      const userId = nextUser();

      await callUntilBlocked(deps.catalog, () => draft(order, userId, 1));

      await expectOnlyOpen(order, DEPENDENCY.CATALOG);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'P2 inventory duser: catalog saglam, Reserve kesilir; yalniz devre{inventory} acik',
    async () => {
      const deps = dependencies();
      const order = await startOrder(deps);
      const userId = nextUser();
      const total = await totalOf(order, userId);
      deps.inventory.faults.setAll(UNAVAILABLE);

      await callUntilBlocked(deps.inventory, () => draft(order, userId, total));

      await expectOnlyOpen(order, DEPENDENCY.INVENTORY);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'P3 risk duser: ayni taslakta CreateOrder (Evaluate tekrar edilmez); yalniz devre{risk} acik',
    async () => {
      const deps = dependencies();
      const order = await startOrder(deps);
      const userId = nextUser();
      const orderId = await openDraft(order, userId);
      deps.risk.faults.setAll(UNAVAILABLE);

      await callUntilBlocked(deps.risk, () => createOrder(order, orderId, userId));

      await expectOnlyOpen(order, DEPENDENCY.RISK);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'P4 payment duser: CreateOrder Charge da kesilir; yalniz devre{payment} acik',
    async () => {
      const deps = dependencies();
      const order = await startOrder(deps);
      const userId = nextUser();
      const orderId = await openDraft(order, userId);
      deps.payment.faults.setAll(UNAVAILABLE);

      await callUntilBlocked(deps.payment, () => createOrder(order, orderId, userId));

      await expectOnlyOpen(order, DEPENDENCY.PAYMENT);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'P5 courier duser: odenmis siparisi dagitici atayamaz; devre{courier} acilir ve reddeder',
    async () => {
      const deps = dependencies();
      const order = await startOrder(deps);
      deps.courier.faults.setAll(UNAVAILABLE);
      const userId = nextUser();
      await payOrder(order, await openDraft(order, userId), userId);

      // Dagitici kendi turunda atar: sabit uyku yok, metrik kosulu yoklanir.
      const opened = await waitUntil(
        async () => {
          const courier = (await order.breakers())[DEPENDENCY.COURIER];
          return courier?.state === BREAKER.OPEN && (courier.rejected ?? 0) > 0;
        },
        DISPATCH_BUDGET_MS,
        200,
      );

      expect(opened).toBe(true);
      await expectOnlyOpen(order, DEPENDENCY.COURIER);
    },
    TEST_TIMEOUT_MS,
  );
});
