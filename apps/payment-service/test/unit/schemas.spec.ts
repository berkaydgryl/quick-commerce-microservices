/**
 * Charge istek semasi: proto bicimindeki istek domain komutuna cevrilir.
 */

import { paymentV1 } from '@getir/proto';
import { describe, expect, it } from 'vitest';

import { PAYMENT_METHOD } from '../../src/domain/payment.js';
import { chargeRequestSchema } from '../../src/interfaces/grpc/schemas.js';

const request = (overrides: Partial<paymentV1.ChargeRequest> = {}): paymentV1.ChargeRequest => ({
  orderId: 'ord_1',
  userId: 'usr_1',
  amount: { amountMinor: 4599, currency: '' },
  method: paymentV1.PaymentMethod.PAYMENT_METHOD_CARD,
  cardToken: 'tok_test_4242',
  idempotencyKey: 'anahtar-0001',
  ...overrides,
});

describe('chargeRequestSchema', () => {
  it('bos para birimini TRY yapar, yontemi domain sozlugune cevirir', () => {
    const parsed = chargeRequestSchema.parse(request());

    expect(parsed.amount).toEqual({ amountMinor: 4599, currency: 'TRY' });
    expect(parsed.method).toBe(PAYMENT_METHOD.CARD);
    expect(parsed.cardToken).toBe('tok_test_4242');
  });

  it('kapida odemede jeton undefined olur', () => {
    const parsed = chargeRequestSchema.parse(
      request({ method: paymentV1.PaymentMethod.PAYMENT_METHOD_CASH_ON_DELIVERY, cardToken: '' }),
    );
    expect(parsed.method).toBe(PAYMENT_METHOD.CASH_ON_DELIVERY);
    expect(parsed.cardToken).toBeUndefined();
  });

  it.each([
    ['yontem UNSPECIFIED', { method: paymentV1.PaymentMethod.PAYMENT_METHOD_UNSPECIFIED }],
    ['tutar yok', { amount: undefined }],
    ['tutar sifir', { amount: { amountMinor: 0, currency: 'TRY' } }],
    ['kesirli tutar (kurus tam sayi)', { amount: { amountMinor: 45.99, currency: 'TRY' } }],
    ['baska para birimi', { amount: { amountMinor: 100, currency: 'EUR' } }],
    ['kartli odemede jeton yok', { cardToken: '' }],
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
