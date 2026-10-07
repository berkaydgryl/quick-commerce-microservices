/**
 * CreateOrder, kayitli kart ve siparis ayrintilari (T12.4; B1/B2): bellek
 * deposu, sahte risk, odeme ve stok.
 *
 * Kart NOT_FOUND (kasada yok, silinmis, baskasinin): payment kayit YAZMAZ,
 * hata aynen gecer; siparis AWAITING_PAYMENT ve kilit yerinde kalir, ayni
 * siparis baska kartla yeniden verilir (QA K9 #165 notlari N1, N2).
 *
 * Ayrinti risk adiminin yaziminda siparise girer (onay ani sunucu saati);
 * tekrar denemede ilk yazilan gecerli, farkli gelen yok sayilir ve degeri
 * YAZILMADAN INFO duser.
 */

import { ERROR_CODES, fixedClock, ORDER_STATUS, RISK_BANDS } from '@getir/core';
import { recordingLogger } from '@getir/core/testing';
import type { LogLine } from '@getir/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createCreateOrder } from '../../src/application/create-order.js';
import type { CreateOrderInput } from '../../src/application/create-order.js';
import { PAYMENT_METHOD, PAYMENT_STATUS } from '../../src/domain/checkout-payment.js';
import type { GiftDetails, OrderDetailsInput } from '../../src/domain/order-details.js';
import type { Order } from '../../src/domain/order.js';
import { InMemoryOrderStore } from '../../src/infrastructure/memory/in-memory-order-store.js';
import { FakePayments, TEST_CARD } from '../support/fake-payments.js';
import { FakeRiskAssessment } from '../support/fake-risk-assessment.js';
import { FakeStockReservations, TEST_LOCK_POLICY } from '../support/fake-stock-reservations.js';
import { insertDraft } from '../support/order-builders.js';

const clock = fixedClock(1_760_000_000_000);
const OWNER = 'usr_1';
const SAVED = 'crd_kayitli';
const MISSING = 'crd_silinmis';
const GIFT: GiftDetails = {
  message: 'Doğum günün kutlu olsun',
  senderName: 'Ayşe Demir',
  recipientName: 'Zeynep Kaya',
  recipientPhone: '+905321112233',
};
const FIRST: OrderDetailsInput = {
  gift: GIFT,
  note: 'Zile basma, bebek uyuyor',
  doNotRingBell: true,
};
const OTHER: OrderDetailsInput = { note: 'Kapıcıya bırak', doNotRingBell: false };

let repository: InMemoryOrderStore;
let risk: FakeRiskAssessment;
let payments: FakePayments;
let stock: FakeStockReservations;
let lines: LogLine[];
let create: ReturnType<typeof createCreateOrder>;

beforeEach(() => {
  repository = new InMemoryOrderStore();
  risk = new FakeRiskAssessment();
  payments = new FakePayments();
  payments.cards.set(SAVED, { userId: OWNER, token: TEST_CARD.APPROVED });
  stock = new FakeStockReservations();
  lines = [];
  create = createCreateOrder({
    repository,
    history: repository,
    risk,
    payments,
    stock,
    outbox: repository,
    clock,
    lockPolicy: TEST_LOCK_POLICY,
  });
});

const scope = () => ({ requestId: 'req_kart_1', logger: recordingLogger(lines) });

const byCard = (orderId: string, cardId: string, details = FIRST): CreateOrderInput => ({
  orderId,
  userId: OWNER,
  method: PAYMENT_METHOD.CARD,
  cardId,
  details,
});

async function stored(orderId: string): Promise<Order> {
  const order = await repository.findById(orderId);
  if (order === null) throw new Error(`siparis yok: ${orderId}`);
  return order;
}

describe('CreateOrder(card_id): kart NOT_FOUND ve yeniden deneme', () => {
  it('kart yok: NOT_FOUND aynen gecer; siparis AWAITING_PAYMENT, kilit yerinde, odeme kaydi yok', async () => {
    const { id } = await insertDraft(repository, clock);

    await expect(create(byCard(id, MISSING), scope())).rejects.toMatchObject({
      code: ERROR_CODES.NOT_FOUND,
      details: { resource: 'card' },
    });

    expect((await stored(id)).status).toBe(ORDER_STATUS.AWAITING_PAYMENT);
    expect(stock.commits).toEqual([]);
    expect(stock.releases).toEqual([]);
    await expect(payments.getPayment(id)).resolves.toBeNull();
  });

  it('N1: kart degistirilip yeniden denenince ESKI sonuc donmez, yeni kartla PAID', async () => {
    const { id } = await insertDraft(repository, clock);
    await create(byCard(id, MISSING), scope()).catch(() => undefined);

    const { order } = await create(byCard(id, SAVED), scope());

    expect(order.status).toBe(ORDER_STATUS.PAID);
    // Ayni siparis, AYNI anahtar: NOT_FOUND kayit yazmadigi icin anahtar harcanmamisti.
    expect(
      payments.charges.map(({ cardId, idempotencyKey }) => ({ cardId, idempotencyKey })),
    ).toEqual([
      { cardId: MISSING, idempotencyKey: `charge-${id}` },
      { cardId: SAVED, idempotencyKey: `charge-${id}` },
    ]);
    expect(risk.contexts).toHaveLength(1);
    expect(stock.commits).toHaveLength(1);
  });

  it('N2: es zamanli iki deneme, biri NOT_FOUND digeri PAID: NOT_FOUND alan siparisi BOZMAZ', async () => {
    const { id } = await insertDraft(repository, clock);
    await create(byCard(id, MISSING), scope()).catch(() => undefined);
    // Kayip kartla gelen kopya siparisi AWAITING_PAYMENT okur; payment hemen NOT_FOUND
    // der (kayit yok) ama cevap, diger kopya siparisi PAID yazdiktan SONRA ulasir.
    let reached!: () => void;
    let release!: () => void;
    const atCharge = new Promise<void>((resolve) => (reached = resolve));
    const gate = new Promise<void>((resolve) => (release = resolve));
    const realCharge = payments.charge.bind(payments);
    vi.spyOn(payments, 'charge').mockImplementation(async (request) => {
      const answered = realCharge(request).then(
        (result) => ({ result }),
        (error: unknown) => ({ error }),
      );
      if (request.cardId === MISSING) {
        reached();
        await gate;
      }
      const outcome = await answered;
      if ('error' in outcome) throw outcome.error;
      return outcome.result;
    });

    const lost = create(byCard(id, MISSING), scope());
    await atCharge;
    const { order: paid } = await create(byCard(id, SAVED), scope());
    release();

    await expect(lost).rejects.toMatchObject({
      code: ERROR_CODES.NOT_FOUND,
      details: { resource: 'card' },
    });
    expect(paid.status).toBe(ORDER_STATUS.PAID);
    expect(await stored(id)).toEqual(paid);
    expect(payments.refunds).toEqual([]);
    expect(stock.commits).toHaveLength(1);
    expect(stock.releases).toEqual([]);
  });

  it("N2 diger sira: kayip kartli kopya payment'a SONRA ulasirsa ayni anahtar ilk sonucu doner; iade yok", async () => {
    const { id } = await insertDraft(repository, clock);
    await create(byCard(id, MISSING), scope()).catch(() => undefined);
    let reached!: () => void;
    let release!: () => void;
    const atCharge = new Promise<void>((resolve) => (reached = resolve));
    const gate = new Promise<void>((resolve) => (release = resolve));
    const realCharge = payments.charge.bind(payments);
    vi.spyOn(payments, 'charge').mockImplementation(async (request) => {
      if (request.cardId === MISSING) {
        reached();
        await gate;
      }
      return realCharge(request);
    });

    const late = create(byCard(id, MISSING), scope());
    await atCharge;
    const { order: paid } = await create(byCard(id, SAVED), scope());
    release();

    // payment-svc gibi: ayni anahtarla tekrar kart ARANMADAN ilk kaydi (SUCCEEDED) doner.
    await expect(late).resolves.toMatchObject({ order: { status: ORDER_STATUS.PAID } });
    expect(await stored(id)).toEqual(paid);
    expect(payments.refunds).toEqual([]);
    expect(stock.releases).toEqual([]);
  });
});

describe('CreateOrder: siparis ayrintilari (T12.4)', () => {
  it('risk adiminin yaziminda siparise girer; onay ani SUNUCU saati', async () => {
    const { id } = await insertDraft(repository, clock);

    await create(byCard(id, SAVED), scope());

    expect((await stored(id)).details).toEqual({ ...FIRST, agreementsAcceptedAt: clock.date() });
  });

  it('durdurulan sipariste de yazilir (REVIEW): onay kaydi siparisle kalir', async () => {
    risk.band = RISK_BANDS.HIGH;
    const { id } = await insertDraft(repository, clock);

    await expect(create(byCard(id, SAVED), scope())).rejects.toMatchObject({
      code: ERROR_CODES.RISK_REVIEW,
    });

    expect(await stored(id)).toMatchObject({ status: ORDER_STATUS.REVIEW, details: FIRST });
  });

  it('tekrar denemede ILK ayrinti gecerli; farkli gelen yok sayilir, INFO degersiz', async () => {
    const { id } = await insertDraft(repository, clock);
    await create(byCard(id, MISSING), scope()).catch(() => undefined);

    await create(byCard(id, SAVED, OTHER), scope());

    expect((await stored(id)).details).toEqual({ ...FIRST, agreementsAcceptedAt: clock.date() });
    const ignored = lines.filter((line) => line.message.includes('ayrintisi yok sayildi'));
    expect(ignored).toEqual([
      {
        level: 'info',
        fields: { orderId: id },
        message: 'tekrar denemede farkli siparis ayrintisi yok sayildi',
      },
    ]);
  });

  it('ayni ayrintiyla tekrar (hediye anahtarlari baska sirada): INFO yok', async () => {
    const { id } = await insertDraft(repository, clock);
    await create(byCard(id, MISSING), scope()).catch(() => undefined);
    const { recipientPhone, recipientName, senderName, message } = GIFT;
    const reordered = { recipientPhone, recipientName, senderName, message };

    await create(byCard(id, SAVED, { ...FIRST, gift: reordered }), scope());

    expect(lines.filter((line) => line.message.includes('ayrintisi'))).toEqual([]);
  });

  it('odenmis siparise farkli ayrintiyla tekrar: istek reddedilir, "yok sayildi" INFO yazilmaz', async () => {
    const { id } = await insertDraft(repository, clock);
    await create(byCard(id, SAVED), scope());

    await expect(create(byCard(id, SAVED, OTHER), scope())).rejects.toMatchObject({
      code: ERROR_CODES.ORDER_STATE_INVALID,
    });
    expect(lines.filter((line) => line.message.includes('ayrintisi'))).toEqual([]);
  });

  it('kisisel veri gunluge ve olaylara (outbox) girmez', async () => {
    const { id } = await insertDraft(repository, clock);
    await create(byCard(id, MISSING), scope()).catch(() => undefined);
    await create(byCard(id, SAVED, OTHER), scope());

    const written = JSON.stringify([lines, await repository.pending(100)]);
    const personal = [GIFT.message, GIFT.senderName, GIFT.recipientName, GIFT.recipientPhone];
    for (const value of [...personal, FIRST.note, OTHER.note]) {
      expect(written).not.toContain(value);
    }
  });
});

describe('CreateOrder: 3DS bitisi (T12.4)', () => {
  it('odeme servisinin bitisi cevaba gecer', async () => {
    const expiresAt = new Date(clock.now() + 60_000);
    vi.spyOn(payments, 'charge').mockResolvedValue({
      status: PAYMENT_STATUS.REQUIRES_3DS,
      challengeId: 'tds_1',
      challengeExpiresAt: expiresAt,
    });
    const { id } = await insertDraft(repository, clock);

    await expect(create(byCard(id, SAVED), scope())).resolves.toMatchObject({
      challengeId: 'tds_1',
      challengeExpiresAt: expiresAt,
    });
  });
});
