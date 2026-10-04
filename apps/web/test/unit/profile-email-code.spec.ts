/**
 * E-posta penceresinin saf hesaplari (T11.14): kod penceresi ve geri sayim,
 * kod alaninin rakam suzgeci, form semalari ve sunucu hatasinin forma
 * eslenmesi.
 */

import { EMAIL_CODE_MESSAGE, EMAIL_MESSAGE } from '@getir/contracts';
import { AppError, ERROR_CODES } from '@getir/core';
import { describe, expect, it } from 'vitest';

import { formFeedback } from '../../src/features/auth/services/server-errors';
import { codeDigits, isCompleteCode } from '../../src/features/profile/services/code-input';
import {
  codeWindow,
  formatCountdown,
  secondsUntil,
} from '../../src/features/profile/services/code-window';
import {
  CODE_FORM_FIELDS,
  codeFormSchema,
  EMAIL_FORM_FIELDS,
  emailFormSchema,
} from '../../src/features/profile/services/email-forms';

const RECEIVED_AT = Date.UTC(2026, 9, 4, 12, 0, 0);

describe('codeWindow', () => {
  it('sureler cevabin alindigi andan baslar', () => {
    const window = codeWindow(
      { email: 'ayse@ornek.com', expiresInSeconds: 600, resendAfterSeconds: 60 },
      RECEIVED_AT,
    );

    expect(window).toEqual({
      email: 'ayse@ornek.com',
      expiresAt: RECEIVED_AT + 600_000,
      resendAt: RECEIVED_AT + 60_000,
    });
  });
});

describe('secondsUntil', () => {
  it('kalan saniyeyi yukari yuvarlar: 0,2 sn kala hala 1', () => {
    expect(secondsUntil(RECEIVED_AT + 60_000, RECEIVED_AT)).toBe(60);
    expect(secondsUntil(RECEIVED_AT + 200, RECEIVED_AT)).toBe(1);
  });

  it('sinir gecince 0 (eksiye dusmez)', () => {
    expect(secondsUntil(RECEIVED_AT, RECEIVED_AT)).toBe(0);
    expect(secondsUntil(RECEIVED_AT, RECEIVED_AT + 5_000)).toBe(0);
  });
});

describe('formatCountdown', () => {
  it.each([
    [600, '10:00'],
    [581, '9:41'],
    [60, '1:00'],
    [42, '0:42'],
    [5, '0:05'],
    [0, '0:00'],
  ])('%i sn -> %s', (seconds, text) => {
    expect(formatCountdown(seconds)).toBe(text);
  });
});

describe('codeDigits', () => {
  it.each([
    ['042137', '042137'],
    ['042 137', '042137'],
    ['Kod: 042137.', '042137'],
    ['04213799', '042137'],
    ['abc', ''],
  ])('%j -> %j (yalnizca rakam, en fazla 6)', (raw, digits) => {
    expect(codeDigits(raw)).toBe(digits);
  });

  it('kod tamam mi: tam 6 rakam', () => {
    expect(isCompleteCode('042137')).toBe(true);
    expect(isCompleteCode('04213')).toBe(false);
  });
});

describe('form semalari', () => {
  it('adres kirpilir ve kucuk harfe iner; bicimsiz adres sozlesmenin cumlesiyle', () => {
    expect(emailFormSchema.parse({ email: ' Ayse@Ornek.com ' })).toEqual({
      email: 'ayse@ornek.com',
    });
    const invalid = emailFormSchema.safeParse({ email: 'ayse@' });
    expect(invalid.success).toBe(false);
    expect(invalid.error?.issues[0]?.message).toBe(EMAIL_MESSAGE);
  });

  it('kod 6 rakam olmali', () => {
    const invalid = codeFormSchema.safeParse({ code: '0421' });
    expect(invalid.error?.issues[0]?.message).toBe(EMAIL_CODE_MESSAGE);
    expect(codeFormSchema.parse({ code: '042137' })).toEqual({ code: '042137' });
  });
});

describe('sunucu hatasi -> form', () => {
  const validation = (details: Record<string, string>) =>
    new AppError(ERROR_CODES.VALIDATION_FAILED, 'sozlukten', { details });

  it('adres adimi: email cumlesi alanin altina', () => {
    const feedback = formFeedback(
      validation({ email: 'Bu e-posta adresi başka bir hesapta kayıtlı' }),
      EMAIL_FORM_FIELDS,
    );

    expect(feedback).toEqual({
      fields: { email: 'Bu e-posta adresi başka bir hesapta kayıtlı' },
      message: null,
    });
  });

  it('kod adimi: kod cumlesi alana, adres cumlesi (bu arada baska hesapta) ayri doner', () => {
    expect(
      formFeedback(validation({ code: 'Kod hatalı. 3 deneme hakkın kaldı.' }), CODE_FORM_FIELDS)
        .fields,
    ).toEqual({ code: 'Kod hatalı. 3 deneme hakkın kaldı.' });
    expect(
      formFeedback(
        validation({ email: 'Bu e-posta adresi başka bir hesapta kayıtlı' }),
        CODE_FORM_FIELDS,
      ).fields.email,
    ).toBe('Bu e-posta adresi başka bir hesapta kayıtlı');
  });

  it('erken yeniden gonderme: formun ustunde kalan saniyeyle', () => {
    const feedback = formFeedback(
      new AppError(ERROR_CODES.RATE_LIMITED, 'sozlukten', { details: { retryAfterSeconds: 42 } }),
      EMAIL_FORM_FIELDS,
    );

    expect(feedback.message).toMatch(/\(42 sn\)$/);
  });
});
