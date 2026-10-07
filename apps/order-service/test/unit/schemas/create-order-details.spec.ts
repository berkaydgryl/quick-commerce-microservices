/**
 * CreateOrder semasi (T12.4; B1/B2): kart kaynagi (card_id | card_token, TAM
 * biri) ve ZORUNLU siparis ayrintilari. Kurallar @getir/contracts
 * checkout-rules.ts'ten gelir; burada order'in onlari GERCEKTEN uyguladigi ve
 * hata cumlelerinin degeri YANKILAMADIGI dogrulanir.
 */

import { CHECKOUT_TEXT_MAX, GIFT_NAME_MAX } from '@getir/contracts';
import { orderV1, paymentV1 } from '@getir/proto';
import { describe, expect, it } from 'vitest';

import { createOrderRequestSchema } from '../../../src/interfaces/grpc/create-order-schema.js';
import { createOrderRequest, ORDER_DETAILS } from '../../support/order-fixtures.js';

const CARD_ID = `crd_${'a1'.repeat(16)}`;
const COD = paymentV1.PaymentMethod.PAYMENT_METHOD_CASH_ON_DELIVERY;
const CASH = orderV1.DeliveryPaymentKind.DELIVERY_PAYMENT_KIND_CASH;
const GIFT: orderV1.GiftDetails = {
  message: 'İyi ki doğdun',
  senderName: 'Ayşe',
  recipientName: 'Mehmet Yılmaz',
  recipientPhone: '+905321234567',
};

const request = createOrderRequest('ord_1');
const parse = (overrides: Partial<orderV1.CreateOrderRequest>) =>
  createOrderRequestSchema.safeParse({ ...request, ...overrides });
const issuesOf = (overrides: Partial<orderV1.CreateOrderRequest>) =>
  (parse(overrides).error?.issues ?? []).map((issue) => [issue.path.join('.'), issue.message]);
const withDetails = (details: Partial<orderV1.OrderDetails>) =>
  issuesOf({ details: { ...ORDER_DETAILS, ...details } });

describe('CreateOrder kart kaynagi (T12.4)', () => {
  it('kayitli kart: card_id tasinir, card_token alani HIC yazilmaz', () => {
    const parsed = createOrderRequestSchema.parse({ ...request, cardToken: '', cardId: CARD_ID });

    expect(parsed.cardId).toBe(CARD_ID);
    expect(parsed).not.toHaveProperty('cardToken');
  });

  it('eski jeton: card_id alani HIC yazilmaz', () => {
    expect(createOrderRequestSchema.parse(request)).not.toHaveProperty('cardId');
  });

  it.each([
    [{ cardId: CARD_ID }, 'card_id ile card_token birlikte gonderilemez'],
    [{ cardToken: '', cardId: 'crd_kisa' }, 'kart kimligi bekleniyor'],
    [
      { cardToken: '', cardId: CARD_ID, paymentMethod: COD, onDelivery: CASH },
      'kapida odemede kart bos olmali',
    ],
  ])('%o: VALIDATION, tek hata, kimlik yankilanmaz', (overrides, message) => {
    const issues = issuesOf(overrides);

    expect(issues).toEqual([['cardId', message]]);
    expect(JSON.stringify(issues)).not.toContain('crd_');
  });
});

describe('CreateOrder siparis ayrintilari (T12.4, ZORUNLU)', () => {
  it('hediyeli ayrinti: metinler kirpilir, onay ve istekteki onay ani tasinmaz', () => {
    const parsed = createOrderRequestSchema.parse({
      ...request,
      details: {
        gift: { ...GIFT, recipientName: '  Mehmet Yılmaz ' },
        note: ' kapıya bırak ',
        doNotRingBell: true,
        agreementsAccepted: true,
        agreementsAcceptedAt: new Date('2020-01-01T00:00:00Z'),
      },
    });

    expect(parsed.details).toEqual({ gift: GIFT, note: 'kapıya bırak', doNotRingBell: true });
  });

  it.each([
    ['kartli', {}],
    ['kapida odemede de', { paymentMethod: COD, cardToken: '', onDelivery: CASH }],
  ])('%s ayrinti yoksa VALIDATION', (_name, overrides) => {
    expect(issuesOf({ ...overrides, details: undefined })).toEqual([
      ['details', 'siparis ayrintilari zorunlu'],
    ]);
  });

  it('sozlesme onayi false: contracts cumlesi', () => {
    expect(withDetails({ agreementsAccepted: false })).toEqual([
      ['details.agreementsAccepted', 'Siparişi vermek için sözleşmeleri onayla'],
    ]);
  });

  it.each([
    [{ note: 'n'.repeat(CHECKOUT_TEXT_MAX + 1) }, 'details.note'],
    [{ gift: { ...GIFT, message: 'm'.repeat(CHECKOUT_TEXT_MAX + 1) } }, 'details.gift.message'],
    [{ gift: { ...GIFT, senderName: 's'.repeat(GIFT_NAME_MAX + 1) } }, 'details.gift.senderName'],
    [{ gift: { ...GIFT, recipientName: '   ' } }, 'details.gift.recipientName'],
    [{ gift: { ...GIFT, recipientPhone: '05321234567' } }, 'details.gift.recipientPhone'],
  ])('kural disi %#: alaniyla tek hata, deger YANKILANMAZ', (details, field) => {
    const issues = withDetails(details);

    expect(issues.map(([path]) => path)).toEqual([field]);
    const echoed = JSON.stringify(issues);
    for (const value of ['nnnnnnnnnn', 'mmmmmmmmmm', 'ssssssssss', '05321234567']) {
      expect(echoed).not.toContain(value);
    }
  });

  it('sinirdaki uzunluklar gecer (UTF-16, kirpilmis)', () => {
    expect(
      withDetails({
        note: ` ${'n'.repeat(CHECKOUT_TEXT_MAX)} `,
        gift: { ...GIFT, senderName: 's'.repeat(GIFT_NAME_MAX) },
      }),
    ).toEqual([]);
  });
});

describe('CreateOrder kapida odemenin turu (T12.4)', () => {
  const POS = orderV1.DeliveryPaymentKind.DELIVERY_PAYMENT_KIND_POS;
  const NONE = orderV1.DeliveryPaymentKind.DELIVERY_PAYMENT_KIND_UNSPECIFIED;

  it.each([
    [CASH, 'CASH'],
    [POS, 'POS'],
  ])('kapida odemede tur %s domain sozlugune (%s)', (onDelivery, kind) => {
    const parsed = createOrderRequestSchema.parse({
      ...request,
      paymentMethod: COD,
      cardToken: '',
      onDelivery,
    });

    expect(parsed.onDelivery).toBe(kind);
  });

  it.each([
    [
      'kapida odemede tur yok',
      { paymentMethod: COD, cardToken: '', onDelivery: NONE },
      'kapida odemede tur zorunlu (nakit ya da POS)',
    ],
    [
      'kartla odemede tur dolu',
      { onDelivery: CASH },
      'kartli odemede kapida odeme turu bos olmali',
    ],
  ])('%s: VALIDATION, onDelivery alaninda tek hata', (_name, overrides, message) => {
    expect(issuesOf(overrides)).toEqual([['onDelivery', message]]);
  });

  it('kartla odemede tur alani HIC yazilmaz', () => {
    expect(createOrderRequestSchema.parse(request)).not.toHaveProperty('onDelivery');
  });

  it('taninmayan tur sayisi (yeni istemci) "tur yok" sayilir: kural cumlesi, zod enum hatasi degil', () => {
    const unknown = 3 as orderV1.DeliveryPaymentKind;

    expect(issuesOf({ paymentMethod: COD, cardToken: '', onDelivery: unknown })).toEqual([
      ['onDelivery', 'kapida odemede tur zorunlu (nakit ya da POS)'],
    ]);
    expect(createOrderRequestSchema.parse({ ...request, onDelivery: unknown })).not.toHaveProperty(
      'onDelivery',
    );
  });
});
