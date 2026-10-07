/**
 * Siparis ayrintilari ve kayitli kartla odeme (T12.4; B1/B2): kurallar tek
 * yerde (checkout-rules.ts), cumleler degeri YANKILAMAZ. Uzunluk UTF-16 kod
 * birimi, kirpilarak olculur.
 */

import { describe, expect, it } from 'vitest';

import {
  AGREEMENTS_MESSAGE,
  CHECKOUT_TEXT_MAX,
  createOrderRequestSchema,
  GIFT_NAME_LENGTH_MESSAGE,
  GIFT_NAME_MAX,
  NOTE_LENGTH_MESSAGE,
  orderDetailsSchema,
  orderDetailsViewSchema,
  PAYMENT_CARD_MESSAGE,
  PHONE_MESSAGE,
  RECIPIENT_NAME_MESSAGE,
} from '../../src/index.js';

const ORDER_ID = 'ord_db77f4c0e24f49919cc1d78a649c9c94';
const CARD_ID = 'crd_0123456789abcdef0123456789abcdef';
const GIFT = {
  enabled: true,
  message: 'İyi ki doğdun',
  senderName: 'Ayşe',
  recipientName: 'Mehmet',
  recipientPhone: '+905321234567',
} as const;
const DETAILS = { note: 'Kapıda bırak', doNotRingBell: true, agreementsAccepted: true } as const;

/** Ilk hatanin cumlesi ve yolu; gecerse undefined. */
function firstIssue(value: unknown): { message: string; path: string } | undefined {
  const result = orderDetailsSchema.safeParse(value);
  if (result.success) return undefined;
  const [issue] = result.error.issues;
  return issue === undefined ? undefined : { message: issue.message, path: issue.path.join('.') };
}

describe('orderDetailsSchema (T12.4)', () => {
  it('hediyesiz ve hediyeli ayrintilar gecer; metinler kirpilir', () => {
    expect(orderDetailsSchema.parse(DETAILS)).toEqual(DETAILS);
    expect(
      orderDetailsSchema.parse({
        ...DETAILS,
        note: '  zil yok  ',
        gift: { ...GIFT, recipientName: ' Mehmet ' },
      }),
    ).toMatchObject({ note: 'zil yok', gift: { recipientName: 'Mehmet' } });
  });

  it('alici adi bosluktan ibaret olamaz', () => {
    expect(firstIssue({ ...DETAILS, gift: { ...GIFT, recipientName: '   ' } })).toEqual({
      message: RECIPIENT_NAME_MESSAGE,
      path: 'gift.recipientName',
    });
  });

  it('alici telefonu E.164 cep numarasi', () => {
    expect(firstIssue({ ...DETAILS, gift: { ...GIFT, recipientPhone: '05321234567' } })).toEqual({
      message: PHONE_MESSAGE,
      path: 'gift.recipientPhone',
    });
  });

  it('sinirlar UTF-16 kod birimiyle: tam sinirda gecer, bir fazlasi gecmez', () => {
    const name = 'ğ'.repeat(GIFT_NAME_MAX);
    const note = 'a'.repeat(CHECKOUT_TEXT_MAX);

    expect(
      firstIssue({ ...DETAILS, note, gift: { ...GIFT, recipientName: name } }),
    ).toBeUndefined();
    expect(firstIssue({ ...DETAILS, note: `${note}a` })?.message).toBe(NOTE_LENGTH_MESSAGE);
    expect(firstIssue({ ...DETAILS, gift: { ...GIFT, senderName: `${name}ğ` } })?.message).toBe(
      GIFT_NAME_LENGTH_MESSAGE,
    );
    // Emoji iki UTF-16 birimidir: web formuyla ayni sayilir.
    expect(firstIssue({ ...DETAILS, note: '😀'.repeat(CHECKOUT_TEXT_MAX / 2) })).toBeUndefined();
    expect(
      firstIssue({ ...DETAILS, note: `${'😀'.repeat(CHECKOUT_TEXT_MAX / 2)}a` })?.message,
    ).toBe(NOTE_LENGTH_MESSAGE);
  });

  it('sozlesme onayi zorunlu', () => {
    expect(firstIssue({ ...DETAILS, agreementsAccepted: false })).toEqual({
      message: AGREEMENTS_MESSAGE,
      path: 'agreementsAccepted',
    });
  });

  it('cumleler degeri YANKILAMAZ (kisisel veri hataya girmez)', () => {
    const secret = 'Gizli Alıcı Adı'.repeat(10);
    const result = orderDetailsSchema.safeParse({
      ...DETAILS,
      note: `${secret}${'x'.repeat(CHECKOUT_TEXT_MAX)}`,
      gift: { ...GIFT, recipientName: secret, recipientPhone: '+90999' },
    });

    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).not.toContain('Gizli');
    expect(JSON.stringify(result.error?.issues)).not.toContain('+90999');
  });

  it('cevapta onayin sunucu ani da vardir; hediyede enabled yok, istek kurallari cevabi dogrulamaz', () => {
    const { enabled: _enabled, ...giftView } = GIFT;
    const view = {
      ...DETAILS,
      note: 'x'.repeat(CHECKOUT_TEXT_MAX + 50),
      gift: giftView,
      agreementsAcceptedAt: '2026-10-07T09:00:00.000Z',
    };

    expect(orderDetailsViewSchema.safeParse(view).success).toBe(true);
    expect(
      orderDetailsViewSchema.safeParse({ ...view, agreementsAcceptedAt: undefined }).success,
    ).toBe(false);
  });
});

describe('createOrderRequestSchema odeme (T12.4)', () => {
  const request = (payment: Record<string, unknown>) =>
    createOrderRequestSchema.safeParse({ orderId: ORDER_ID, payment, details: DETAILS });

  it('kayitli kartin kimligi ya da (eski) jeton: tam biri', () => {
    expect(request({ method: 'CARD', cardId: CARD_ID }).success).toBe(true);
    expect(request({ method: 'CARD', cardToken: 'tok_test_4242' }).success).toBe(true);

    const both = request({ method: 'CARD', cardId: CARD_ID, cardToken: 'tok_test_4242' });
    const none = request({ method: 'CARD' });
    expect(both.success).toBe(false);
    expect(none.success).toBe(false);
    expect(none.error?.issues[0]).toMatchObject({
      message: PAYMENT_CARD_MESSAGE,
      path: ['payment', 'cardId'],
    });
  });

  it('kart kimligi kasa bicimi (crd_ + 32 onaltilik)', () => {
    expect(request({ method: 'CARD', cardId: 'crd_1' }).success).toBe(false);
    expect(
      request({ method: 'CARD', cardId: 'ord_0123456789abcdef0123456789abcdef' }).success,
    ).toBe(false);
  });
});
