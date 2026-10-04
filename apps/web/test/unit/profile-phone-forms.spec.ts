/**
 * Telefon adiminin formu ve sunucu hatalari (T11.14 PR 3).
 */

import { PHONE_MESSAGE } from '@getir/contracts';
import { AppError, ERROR_CODES } from '@getir/core';
import { describe, expect, it } from 'vitest';

import {
  PHONE_CHANGE_FIELDS,
  PHONE_CODE_FIELDS,
  needsPassword,
  phoneChangeFormSchema,
  phoneFeedback,
} from '../../src/features/profile/services/phone-forms';

describe('phoneChangeFormSchema', () => {
  it('10 rakami +90 ile E.164 yapar; sifreyi aynen birakir', () => {
    expect(
      phoneChangeFormSchema.parse({ phone: '5559876543', password: 'Demo-Sifre-2026' }),
    ).toEqual({
      phone: '+905559876543',
      password: 'Demo-Sifre-2026',
    });
  });

  it('eksik numara sozlesmenin cumlesiyle, kisa sifre kurala gore reddedilir', () => {
    const result = phoneChangeFormSchema.safeParse({ phone: '555', password: 'kisa' });
    const messages = Object.fromEntries(
      (result.error?.issues ?? []).map((issue) => [String(issue.path[0]), issue.message]),
    );

    expect(messages['phone']).toBe(PHONE_MESSAGE);
    expect(messages['password']).toMatch(/en az 8 karakter/);
  });
});

describe('phoneFeedback', () => {
  const taken = new AppError(ERROR_CODES.PHONE_ALREADY_REGISTERED, 'sozlukten', {
    details: { phone: 'Bu numara başka bir hesapta kayıtlı' },
  });

  it('baska hesaptaki numara: sozlugun "giris yap" cumlesi degil, sunucunun alan cumlesi', () => {
    expect(phoneFeedback(taken, PHONE_CHANGE_FIELDS)).toEqual({
      fields: { phone: 'Bu numara başka bir hesapta kayıtlı' },
      message: null,
    });
  });

  it('kod adiminda numara alani formun ustune cikar (PHONE_CODE_FIELDS)', () => {
    expect(phoneFeedback(taken, PHONE_CODE_FIELDS).fields.phone).toBe(
      'Bu numara başka bir hesapta kayıtlı',
    );
    expect(phoneFeedback(taken, [] as const).message).toBe('Bu numara başka bir hesapta kayıtlı');
  });

  it('yanlis sifre: sifre alaninin altinda (VALIDATION_FAILED {password})', () => {
    const wrong = new AppError(ERROR_CODES.VALIDATION_FAILED, 'sozlukten', {
      details: { password: 'Şifre hatalı' },
    });

    expect(phoneFeedback(wrong, PHONE_CHANGE_FIELDS)).toEqual({
      fields: { password: 'Şifre hatalı' },
      message: null,
    });
  });
});

describe('needsPassword (yeniden gonderim, karar a)', () => {
  it('kodun omru dolunca sunucunun sifre istegini tanir', () => {
    const asked = new AppError(ERROR_CODES.VALIDATION_FAILED, 'sozlukten', {
      details: { password: 'Numarayı değiştirmek için şifreni gir' },
    });
    expect(needsPassword(asked)).toBe(true);
  });

  it.each([
    [
      'kod alani hatasi',
      new AppError(ERROR_CODES.VALIDATION_FAILED, 'x', { details: { code: 'Kod hatalı.' } }),
    ],
    ['bekleme', new AppError(ERROR_CODES.RATE_LIMITED, 'x', { details: { password: 'x' } })],
    ['ag hatasi', new Error('ag')],
  ])('baska hatada formdan cikmaz (%s)', (_name, error) => {
    expect(needsPassword(error)).toBe(false);
  });
});
