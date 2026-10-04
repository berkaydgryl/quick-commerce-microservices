/**
 * Telefon degistirme ve ad duzenleme semalari (T11.14 PR 3).
 */

import { describe, expect, it } from 'vitest';

import {
  phoneCodeSentSchema,
  sendPhoneCodeRequestSchema,
  updateProfileRequestSchema,
  userProfileSchema,
  VERIFICATION_CODE_MESSAGE,
  verifyPhoneRequestSchema,
} from '../../src/index.js';

describe('sendPhoneCodeRequestSchema', () => {
  it('numara degistirirken sifreyle, simdiki numarayi dogrularken sifresiz gecerli', () => {
    expect(
      sendPhoneCodeRequestSchema.safeParse({ phone: '+905559876543', password: 'Demo-Sifre-2026' })
        .success,
    ).toBe(true);
    expect(sendPhoneCodeRequestSchema.safeParse({ phone: '+905559876543' }).success).toBe(true);
  });

  it('bicimsiz numara ve kisa sifre reddedilir', () => {
    expect(sendPhoneCodeRequestSchema.safeParse({ phone: '05559876543' }).success).toBe(false);
    expect(
      sendPhoneCodeRequestSchema.safeParse({ phone: '+905559876543', password: 'kisa' }).success,
    ).toBe(false);
  });
});

describe('verifyPhoneRequestSchema ve phoneCodeSentSchema', () => {
  it('kod 6 rakam olmali (e-postayla ayni cumle)', () => {
    const result = verifyPhoneRequestSchema.safeParse({ phone: '+905559876543', code: '12a456' });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe(VERIFICATION_CODE_MESSAGE);
    expect(
      verifyPhoneRequestSchema.safeParse({ phone: '+905559876543', code: '042137' }).success,
    ).toBe(true);
  });

  it('gonderim cevabi numara ve sureler', () => {
    const sent = { phone: '+905559876543', expiresInSeconds: 600, resendAfterSeconds: 60 };
    expect(phoneCodeSentSchema.parse(sent)).toEqual(sent);
  });
});

describe('updateProfileRequestSchema ve phoneVerified', () => {
  it('ad kirpilir; kayittaki kural', () => {
    expect(updateProfileRequestSchema.parse({ fullName: '  Ayşe Kaya ' })).toEqual({
      fullName: 'Ayşe Kaya',
    });
    expect(updateProfileRequestSchema.safeParse({ fullName: 'A' }).success).toBe(false);
  });

  it('profil phoneVerified tasiyabilir; yoksa dogrulanmamis', () => {
    const profile = {
      id: 'usr_0123456789abcdef0123456789abcdef',
      phone: '+905321234567',
      fullName: 'Ayşe',
    };
    expect(userProfileSchema.parse({ ...profile, phoneVerified: true }).phoneVerified).toBe(true);
    expect(userProfileSchema.parse(profile).phoneVerified).toBeUndefined();
  });
});
