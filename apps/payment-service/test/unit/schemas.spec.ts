/**
 * Charge istek semasi: proto bicimindeki istek domain komutuna cevrilir.
 */

import { paymentV1 } from '@getir/proto';
import { describe, expect, it } from 'vitest';

import { PAYMENT_METHOD } from '../../src/domain/payment.js';
import { chargeRequestSchema, refundRequestSchema } from '../../src/interfaces/grpc/schemas.js';

const CARD_ID = 'crd_0123456789abcdef0123456789abcdef';

const request = (overrides: Partial<paymentV1.ChargeRequest> = {}): paymentV1.ChargeRequest => ({
  orderId: 'ord_1',
  userId: 'usr_1',
  amount: { amountMinor: 4599, currency: '' },
  method: paymentV1.PaymentMethod.PAYMENT_METHOD_CARD,
  cardToken: 'tok_test_4242',
  cardId: '',
  idempotencyKey: 'anahtar-0001',
  requireThreeDs: false,
  ...overrides,
});

describe('chargeRequestSchema', () => {
  it('bos para birimini TRY yapar, yontemi domain sozlugune cevirir', () => {
    const parsed = chargeRequestSchema.parse(request());

    expect(parsed.amount).toEqual({ amountMinor: 4599, currency: 'TRY' });
    expect(parsed.method).toBe(PAYMENT_METHOD.CARD);
    expect(parsed.card).toEqual({ cardToken: 'tok_test_4242' });
  });

  it('kapida odemede kart yok (undefined)', () => {
    const parsed = chargeRequestSchema.parse(
      request({ method: paymentV1.PaymentMethod.PAYMENT_METHOD_CASH_ON_DELIVERY, cardToken: '' }),
    );
    expect(parsed.method).toBe(PAYMENT_METHOD.CASH_ON_DELIVERY);
    expect(parsed.card).toBeUndefined();
  });

  it('kayitli kart (T12.4): card_id kart kaynagi olur', () => {
    const parsed = chargeRequestSchema.parse(request({ cardToken: '', cardId: CARD_ID }));

    expect(parsed.card).toEqual({ cardId: CARD_ID });
  });

  it.each([
    ['yontem UNSPECIFIED', { method: paymentV1.PaymentMethod.PAYMENT_METHOD_UNSPECIFIED }],
    ['tutar yok', { amount: undefined }],
    ['tutar sifir', { amount: { amountMinor: 0, currency: 'TRY' } }],
    ['kesirli tutar (kurus tam sayi)', { amount: { amountMinor: 45.99, currency: 'TRY' } }],
    ['baska para birimi', { amount: { amountMinor: 100, currency: 'EUR' } }],
    ['kartli odemede kart yok', { cardToken: '' }],
    ['card_id ile card_token birlikte (T12.4)', { cardId: CARD_ID }],
    ['card_id bicimsiz', { cardToken: '', cardId: 'crd_1' }],
    [
      'kapida odemede card_id var',
      {
        method: paymentV1.PaymentMethod.PAYMENT_METHOD_CASH_ON_DELIVERY,
        cardToken: '',
        cardId: CARD_ID,
      },
    ],
    [
      'kapida odemede jeton var',
      { method: paymentV1.PaymentMethod.PAYMENT_METHOD_CASH_ON_DELIVERY },
    ],
    ['kisa idempotency anahtari', { idempotencyKey: 'kisa' }],
    ['orderId bos', { orderId: ' ' }],
  ])('reddeder: %s', (_, overrides) => {
    expect(chargeRequestSchema.safeParse(request(overrides)).success).toBe(false);
  });
});

describe('chargeRequestSchema - risk 3DS bayragi (T7.1)', () => {
  it('kartli odemede tasinir; gonderilmezse (proto3) false', () => {
    expect(chargeRequestSchema.parse(request({ requireThreeDs: true })).requireThreeDs).toBe(true);
    expect(chargeRequestSchema.parse(request()).requireThreeDs).toBe(false);
  });

  it('kapida odemede 3DS istenemez: celiskili istek sessizce yok sayilmaz', () => {
    const result = chargeRequestSchema.safeParse(
      request({
        method: paymentV1.PaymentMethod.PAYMENT_METHOD_CASH_ON_DELIVERY,
        cardToken: '',
        requireThreeDs: true,
      }),
    );

    expect(result.error?.issues.map((issue) => [issue.path.join('.'), issue.message])).toEqual([
      ['requireThreeDs', 'kapida odemede 3DS istenemez'],
    ]);
  });
});

describe('refundRequestSchema (T7.1)', () => {
  const valid = { orderId: 'ord_1', reason: 'order_cancelled', idempotencyKey: 'iade-ord_1' };

  it('gerekce anahtari kucuk harf, rakam ve alt cizgi', () => {
    expect(refundRequestSchema.parse(valid)).toEqual(valid);
    expect(refundRequestSchema.safeParse({ ...valid, reason: 'Siparis iptal' }).success).toBe(
      false,
    );
  });

  it('iade de mutasyondur: anahtar zorunlu (ADR-08)', () => {
    expect(refundRequestSchema.safeParse({ ...valid, idempotencyKey: '' }).success).toBe(false);
  });
});
