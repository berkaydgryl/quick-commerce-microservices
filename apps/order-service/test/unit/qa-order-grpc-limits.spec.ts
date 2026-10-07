/**
 * QA kara kutu (T15.2, order geriye donuk PR 2; OQ6): CreateDraftOrder, CreateOrder ve
 * ConfirmPayment gRPC SINIRLARI (payment PQ5 deseni). Gercek gRPC sunucusu, sahte bagimlilar
 * (order-grpc-harness.ts); bellek deposu disaridan verilir ki kayit sayilsin.
 *
 * Her retten sonra: siparis kaydi YOK, stok kilidi YOK, catalog ve payment CAGRILMAZ, hata metni
 * gonderilen degeri YANKILAMAZ. Sinirlar sozlesme sabitlerinden; sinirin iki yani.
 *
 *   L1 taslak: kalem sayisi, adet, adres ve kupon sinirlarinin IKI yani (sinirda sema gecer, bir
 *      ustunde sessiz ret); sinirdaki adetle taslak acilir.
 *   L2 siparis: odeme yontemi yok, kart kaynagi ikisi birden, kapida odemede kart ya da turu yok;
 *      odeme beklerken yontem degisimi CONFLICT (yeni cekim yok, siparis degismez).
 *   L3 onay: bicimsiz kod payment'a gitmez, hak yanmaz; ardindan dogru kod siparisi oder.
 *   L4 MEVCUT ust sinir bosluklari (#147 benzeri): kullanici ve urun kimliginde uzunluk siniri
 *      yok (uzun kimlikle taslak acilir; satilmayan uzun urun kimligi ayrintida yankilanir),
 *      beklenen tutarda ust sinir yok (2^53 INTERNAL). Sinir eklenince bu testler TERSINE doner.
 */

import {
  ADDRESS_LINE_MAX_LENGTH,
  CART_ITEM_MAX_QUANTITY,
  CART_MAX_ITEMS,
  COUPON_CODE_MAX_LENGTH,
} from '@getir/contracts';
import { ERROR_CODES, GRPC_STATUS } from '@getir/core';
import { orderV1, paymentV1 } from '@getir/proto';
import { appErrorOf } from '@getir/service-kit/testing';
import type { CallResult } from '@getir/service-kit/testing';
import { describe, expect, it } from 'vitest';

import { InMemoryOrderStore } from '../../src/infrastructure/memory/in-memory-order-store.js';
import { nextUser } from '../support/qa-order-calls.js';
import { FakeCatalogPricing } from '../support/fake-catalog-pricing.js';
import { FakePayments, TEST_CARD } from '../support/fake-payments.js';
import { FakeStockReservations } from '../support/fake-stock-reservations.js';
import {
  confirmPaymentRequest,
  createOrderRequest,
  draftRequest,
  DRAFT_TOTAL_MINOR,
} from '../support/order-fixtures.js';
import { useOrderGrpcServer } from '../support/order-grpc-harness.js';

const store = new InMemoryOrderStore();
const stock = new FakeStockReservations();
const payments = new FakePayments();
const catalog = new FakeCatalogPricing();
// Sahte stok bol: sinirdaki adetli taslak (99) sonraki testlerin taslagini engellemesin.
stock.available.set('SUT-1L', 100_000);
const call = useOrderGrpcServer({
  catalog,
  stock,
  payments,
  store: { repository: store, history: store, outbox: store },
});
const service = orderV1.OrderServiceService;
const MARK = 'QA-YANKI-ISARETI';

/**
 * Yan etkiler: kayit sayisi ve (verildiyse) siparisin kendisi, stokun butun cagrilari, catalog
 * ve payment'in butun cagrilari.
 */
const effects = async (orderId?: string) => ({
  orders: store.size,
  order: orderId === undefined ? undefined : await store.findById(orderId),
  stock: [stock.reserves, stock.commits, stock.releases, stock.extends, stock.shortens].map(
    (calls) => calls.length,
  ),
  catalog: catalog.requestIds.length,
  payments: [payments.charges, payments.confirmations, payments.refunds, payments.lookups].map(
    (calls) => calls.length,
  ),
});

/** Hatanin kullaniciya giden butun metni: mesaj ve ayrinti. */
const textOf = (result: CallResult<unknown>) =>
  `${result.error?.message ?? ''} ${JSON.stringify(appErrorOf(result.error) ?? {})}`;

/**
 * Istek reddedilir (INVALID_ARGUMENT + VALIDATION_FAILED), yan etki yok (hedef siparis dahil),
 * isaret yankilanmaz.
 */
async function expectQuietRejection(
  send: () => Promise<CallResult<unknown>>,
  orderId?: string,
): Promise<void> {
  const before = await effects(orderId);
  const result = await send();
  expect(result.error?.code).toBe(GRPC_STATUS.INVALID_ARGUMENT);
  expect(appErrorOf(result.error)?.code).toBe(ERROR_CODES.VALIDATION_FAILED);
  expect(await effects(orderId)).toEqual(before);
  expect(textOf(result)).not.toContain(MARK);
}

/** Sinirdaki deger semadan GECER: istek fiyatlamaya (catalog) ulasir; sonucu ayrica denetlenir. */
async function expectPastSchema(
  send: () => Promise<CallResult<unknown>>,
): Promise<CallResult<unknown>> {
  const before = catalog.requestIds.length;
  const result = await send();
  expect(catalog.requestIds.length).toBeGreaterThan(before);
  return result;
}

const draft = (overrides: Partial<orderV1.CreateDraftOrderRequest>) =>
  call(service.createDraftOrder, { ...draftRequest, userId: nextUser(), ...overrides });

const line = (index: number) => ({ productId: `prd_qa_${String(index)}`, sku: '', quantity: 1 });

/** Taslak acar (kimlik). */
async function openDraft(userId: string): Promise<string> {
  const { response, error } = await call(service.createDraftOrder, { ...draftRequest, userId });
  if (response === undefined) throw new Error(`taslak acilamadi: ${error?.message ?? ''}`);
  return response.orderId;
}

describe('QA OQ6 order gRPC sinirlari: ret sessiz ve yan etkisiz', () => {
  it('L1 taslak: kalem, adet, adres ve kupon sinirlarinin iki yani; sinirdaki adet acilir', async () => {
    // Sinirda: sema gecer (catalog'a ulasir). Satilmayan urunler ve bilinmeyen kupon fiyatlamanin isi.
    const atMaxLines = Array.from({ length: CART_MAX_ITEMS }, (_, index) => line(index));
    await expectPastSchema(() => draft({ lines: atMaxLines }));
    const atMaxAddress = await expectPastSchema(() =>
      draft({ deliveryAddress: 'a'.repeat(ADDRESS_LINE_MAX_LENGTH) }),
    );
    expect(atMaxAddress.error).toBeUndefined();
    await expectPastSchema(() => draft({ couponCode: 'K'.repeat(COUPON_CODE_MAX_LENGTH) }));
    // Sinirin bir ustu: semada sessiz ret.
    const tooMany = Array.from({ length: CART_MAX_ITEMS + 1 }, (_, index) => line(index));
    await expectQuietRejection(() => draft({ lines: tooMany }));
    for (const quantity of [0, -1, CART_ITEM_MAX_QUANTITY + 1]) {
      await expectQuietRejection(() =>
        draft({ lines: [{ productId: 'prd_01', sku: 'SUT-1L', quantity }] }),
      );
    }
    await expectQuietRejection(() =>
      draft({ deliveryAddress: `${MARK}${'a'.repeat(ADDRESS_LINE_MAX_LENGTH + 1 - MARK.length)}` }),
    );
    await expectQuietRejection(() =>
      draft({ couponCode: `${MARK}${'K'.repeat(COUPON_CODE_MAX_LENGTH + 1 - MARK.length)}` }),
    );

    // Sinirdaki adet: fiyat sunucuda hesaplanir; ilk deneme yeni toplami soyler, ikincisi acar.
    const maxLine = { productId: 'prd_01', sku: 'SUT-1L', quantity: CART_ITEM_MAX_QUANTITY };
    const userId = nextUser();
    const priced = await call(service.createDraftOrder, {
      ...draftRequest,
      userId,
      lines: [maxLine],
    });
    expect(appErrorOf(priced.error)?.code).toBe(ERROR_CODES.PRICE_CHANGED);
    const details: unknown = appErrorOf(priced.error)?.details;
    const totalMinor =
      typeof details === 'object' && details !== null && 'totalMinor' in details
        ? Number(details.totalMinor)
        : Number.NaN;
    const opened = await call(service.createDraftOrder, {
      ...draftRequest,
      userId,
      lines: [maxLine],
      expectedTotal: { amountMinor: totalMinor, currency: 'TRY' },
    });
    expect(opened.error).toBeUndefined();
    expect(stock.reserves.at(-1)?.lines).toEqual([
      { sku: 'SUT-1L', quantity: CART_ITEM_MAX_QUANTITY },
    ]);
  });

  it('L2 siparis: yontem ve kart kaynagi kurallari; odeme beklerken yontem degisimi CONFLICT', async () => {
    const userId = nextUser();
    const orderId = await openDraft(userId);
    const order = (overrides: Partial<orderV1.CreateOrderRequest>) =>
      call(service.createOrder, createOrderRequest(orderId, { userId, ...overrides }));
    const cardId = `card_${'a'.repeat(32)}`;
    const cash = orderV1.DeliveryPaymentKind.DELIVERY_PAYMENT_KIND_CASH;
    const cod = paymentV1.PaymentMethod.PAYMENT_METHOD_CASH_ON_DELIVERY;

    await expectQuietRejection(
      () => order({ paymentMethod: paymentV1.PaymentMethod.PAYMENT_METHOD_UNSPECIFIED }),
      orderId,
    );
    await expectQuietRejection(() => order({ cardId, cardToken: TEST_CARD.APPROVED }), orderId);
    await expectQuietRejection(
      () => order({ cardToken: TEST_CARD.APPROVED, onDelivery: cash }),
      orderId,
    );
    await expectQuietRejection(() => order({ paymentMethod: cod, cardToken: '' }), orderId);
    await expectQuietRejection(
      () => order({ paymentMethod: cod, cardToken: TEST_CARD.APPROVED, onDelivery: cash }),
      orderId,
    );

    // 3DS bekleyen siparise kapida odeme: CONFLICT; yeni cekim yok, siparis degismez.
    const pending = await order({ cardToken: TEST_CARD.CHALLENGE });
    expect(pending.response?.challengeId).not.toBe('');
    const before = await store.findById(orderId);
    const charges = payments.charges.length;
    const changed = await order({ paymentMethod: cod, cardToken: '', onDelivery: cash });
    expect(changed.error?.code).toBe(GRPC_STATUS.ABORTED);
    expect(appErrorOf(changed.error)?.code).toBe(ERROR_CODES.CONFLICT);
    expect(payments.charges.length).toBe(charges);
    expect(await store.findById(orderId)).toEqual(before);
  });

  it('L3 onay: bicimsiz kod payment a gitmez, hak yanmaz; sonra dogru kod PAID', async () => {
    const userId = nextUser();
    const orderId = await openDraft(userId);
    const pending = await call(
      service.createOrder,
      createOrderRequest(orderId, { userId, cardToken: TEST_CARD.CHALLENGE }),
    );
    const challengeId = pending.response?.challengeId ?? '';
    expect(challengeId).not.toBe('');
    for (const code of ['12345', '1234567', 'abcdef', `${MARK}`, '12 345']) {
      await expectQuietRejection(
        () =>
          call(
            service.confirmPayment,
            confirmPaymentRequest(orderId, challengeId, { userId, code }),
          ),
        orderId,
      );
    }
    // Hak yanmadi, dogrulama hala gecerli: dogru kod siparisi oder.
    const confirmed = await call(
      service.confirmPayment,
      confirmPaymentRequest(orderId, challengeId, { userId }),
    );
    expect(confirmed.response?.status).toBe(orderV1.OrderStatus.ORDER_STATUS_PAID);
  });

  it('L4 MEVCUT: kimlik uzunlugu ve beklenen tutar ust siniri yok (#147 benzeri)', async () => {
    // Uzun kullanici kimligi: taslak ACILIR (sinir eklenince VALIDATION olmali).
    const longUser = `usr_${'f'.repeat(4_096)}`;
    const opened = await call(service.createDraftOrder, { ...draftRequest, userId: longUser });
    expect(opened.error).toBeUndefined();

    // Satilmayan uzun urun kimligi catalog'a gider ve hata ayrintisinda AYNEN geri doner.
    const longProduct = `prd_${MARK}${'x'.repeat(4_096)}`;
    const unknown = await draft({ lines: [{ productId: longProduct, sku: '', quantity: 1 }] });
    expect(unknown.error?.code).toBe(GRPC_STATUS.INVALID_ARGUMENT);
    expect(textOf(unknown)).toContain(longProduct);

    // Guvenli tam sayiyi asan beklenen tutar: INTERNAL (payment #147 ile ayni sinif).
    const huge = await draft({ expectedTotal: { amountMinor: 2 ** 53, currency: 'TRY' } });
    expect(huge.error?.code).toBe(GRPC_STATUS.INTERNAL);
    // Guvenli sinirin altindaki buyuk tutar yalniz fiyat farki: PRICE_CHANGED, gercek toplamla.
    const large = await draft({ expectedTotal: { amountMinor: 2 ** 53 - 1, currency: 'TRY' } });
    expect(appErrorOf(large.error)).toMatchObject({
      code: ERROR_CODES.PRICE_CHANGED,
      details: { totalMinor: DRAFT_TOTAL_MINOR },
    });
  });
});
