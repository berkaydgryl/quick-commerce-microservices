/**
 * QA kara kutu (T15.3; bekleyen is 124): para alinmis ve stok kilidi inventory'de HALA duruyor
 * ya da kesinlesmisken siparis "kilidi dusmus" gorunur. Commit yoklamasi siparisi PAID
 * tamamlar; para ikinci kez CEKILMEZ, iade EDILMEZ, stok kesinlesir. Gercek order + payment +
 * inventory (qa-payment-world.ts).
 *
 *   P1 kart cekimi basarili, cevap kayboldu; kilidin suresi gecti ama inventory henuz birakmadi
 *      (supurucu kosmadi): tekrar -> Commit APPLIED -> PAID (gercek commit.lua sureyi sormaz).
 *   P2 cekim ve Commit basarili, PAID yazimi dustu; kilidin suresi gecti: tekrar -> Commit
 *      ALREADY_APPLIED -> PAID; payment'a ikinci Charge GITMEZ.
 *   P3 3DS onayi payment'ta basarili, cevap kayboldu; kilidin suresi gecti: onay tekrari ->
 *      PAID; kod payment'a ikinci kez GITMEZ.
 *
 * Her senaryonun sonunda AYNI para ve stok denetimi (qa-money-checks.ts).
 */

import { ERROR_CODES, ORDER_STATUS } from '@getir/core';
import { orderV1 } from '@getir/proto';
import { appErrorOf } from '@getir/service-kit/testing';
import { describe, expect, it } from 'vitest';

import { TEST_CARD } from '../support/fake-payments.js';
import { expectSettled, moneyOf, refundCommands, stockState } from '../support/qa-money-checks.js';
import {
  DRAFT_QUANTITY,
  PAST_LOCK_MS,
  useInventoryWorld,
  useShops,
} from '../support/qa-payment-world.js';

const world = useInventoryWorld('qa_dusmus_kilit_paid');
const openShop = useShops(world);

const PAID_SETTLEMENT = {
  status: ORDER_STATUS.PAID,
  charged: 1,
  refunded: 0,
  onHandDelta: -DRAFT_QUANTITY,
  committed: true,
} as const;

describe('QA #124 para alinmis, stok kilidi duruyor ya da kesinlesmis: PAID tamamlanir', () => {
  it('P1 cevap kayboldu, kilidin suresi gecti ama inventory birakmadi: tekrar PAID, iade yok', async () => {
    const shop = await openShop();
    const userId = shop.nextUser();
    const orderId = await shop.draft(userId);
    const before = await stockState(world, orderId);
    const held = shop.faults.holdReply('charge', orderId);
    const first = await shop.createOrder(orderId, userId);
    held.open();
    expect(appErrorOf(first.error)?.code).toBe(ERROR_CODES.SERVICE_UNAVAILABLE);
    // Suresi gecti; inventory'nin supurucusu KOSMADI: kilit Redis'te duruyor.
    world.clock.advance(PAST_LOCK_MS);

    const retry = await shop.createOrder(orderId, userId);

    expect(retry.error).toBeUndefined();
    expect(retry.response?.status).toBe(orderV1.OrderStatus.ORDER_STATUS_PAID);
    expect(shop.faults.calls('charge', orderId)).toBe(1);
    expect(refundCommands(shop, orderId)).toBe(0);
    await expectSettled(world, shop, orderId, before, PAID_SETTLEMENT);
  });

  it('P2 cekim ve Commit basarili, PAID yazilamadi; suresi gecti: tekrar PAID, ikinci Charge yok', async () => {
    const shop = await openShop();
    const userId = shop.nextUser();
    const orderId = await shop.draft(userId);
    const before = await stockState(world, orderId);
    shop.orders.failNextPaid(orderId);
    const first = await shop.createOrder(orderId, userId);
    expect(appErrorOf(first.error)?.code).toBe(ERROR_CODES.SERVICE_UNAVAILABLE);
    expect((await shop.orders.findById(orderId))?.status).toBe(ORDER_STATUS.AWAITING_PAYMENT);
    // Stok ilk denemede kesinlesti: defterde commit var, kilit "kesinlesmis".
    expect((await stockState(world, orderId)).ledger.commit).toBe(1);
    world.clock.advance(PAST_LOCK_MS);

    const retry = await shop.createOrder(orderId, userId);

    expect(retry.error).toBeUndefined();
    expect(retry.response?.status).toBe(orderV1.OrderStatus.ORDER_STATUS_PAID);
    expect(shop.faults.calls('charge', orderId)).toBe(1);
    expect(refundCommands(shop, orderId)).toBe(0);
    await expectSettled(world, shop, orderId, before, PAID_SETTLEMENT);
  });

  it('P3 3DS onayi basarili ama cevap kayboldu; suresi gecti: onay tekrari PAID, kod ikinci kez gitmez', async () => {
    const shop = await openShop();
    const userId = shop.nextUser();
    const orderId = await shop.draft(userId);
    const before = await stockState(world, orderId);
    const created = await shop.createOrder(orderId, userId, TEST_CARD.CHALLENGE);
    const challengeId = created.response?.challengeId ?? '';
    expect(challengeId).not.toBe('');
    // Onay NOT_IDEMPOTENT: cevabi dusurmek yeter (cagri icinde tekrar edilmez).
    shop.faults.dropReply('confirm3Ds', orderId);
    const lost = await shop.confirm(orderId, userId, challengeId);
    expect(appErrorOf(lost.error)?.code).toBe(ERROR_CODES.SERVICE_UNAVAILABLE);
    expect(await moneyOf(shop, orderId)).toEqual({ charged: 1, refunded: 0 });
    world.clock.advance(PAST_LOCK_MS);

    const retry = await shop.confirm(orderId, userId, challengeId);

    expect(retry.error).toBeUndefined();
    expect(shop.faults.calls('confirm3Ds', orderId)).toBe(1);
    expect(refundCommands(shop, orderId)).toBe(0);
    await expectSettled(world, shop, orderId, before, PAID_SETTLEMENT);
  });
});
