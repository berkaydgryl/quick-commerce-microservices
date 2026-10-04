/**
 * E-posta dogrulama semalari (T11.14): bicim kurali, kucuk harf/kirpma ve
 * profilin istege bagli e-postasi.
 */

import { describe, expect, it } from 'vitest';

import {
  VERIFICATION_CODE_MESSAGE,
  EMAIL_MAX_LENGTH,
  EMAIL_MESSAGE,
  emailCodeSentSchema,
  emailSchema,
  sendEmailCodeRequestSchema,
  userProfileSchema,
  verifyEmailRequestSchema,
} from '../../src/index.js';

const USER_ID = 'usr_0123456789abcdef0123456789abcdef';

function firstMessage(result: { success: boolean; error?: { issues: { message: string }[] } }) {
  return result.error?.issues[0]?.message;
}

describe('emailSchema', () => {
  it('bosluklari kirpar ve kucuk harfe cevirir: benzersizlik bu bicimdedir', () => {
    expect(emailSchema.parse('  Ayse.Yilmaz@Ornek.COM ')).toBe('ayse.yilmaz@ornek.com');
  });

  it.each(['ayse', 'ayse@', '@ornek.com', 'ayse@ornek', 'ay se@ornek.com', 'a@b@ornek.com', ''])(
    'bicimsiz adresi (%j) sozlesmedeki cumleyle reddeder',
    (value) => {
      const result = emailSchema.safeParse(value);
      expect(result.success).toBe(false);
      expect(firstMessage(result)).toBe(EMAIL_MESSAGE);
    },
  );

  it(`en fazla ${EMAIL_MAX_LENGTH} karakter kabul eder`, () => {
    const domain = '@ornek.com';
    const limit = `${'a'.repeat(EMAIL_MAX_LENGTH - domain.length)}${domain}`;
    expect(emailSchema.safeParse(limit).success).toBe(true);
    expect(emailSchema.safeParse(`a${limit}`).success).toBe(false);
  });
});

describe('dogrulama govdeleri', () => {
  it('kod gonderme govdesi adresi kucuk harfe cevirir', () => {
    expect(sendEmailCodeRequestSchema.parse({ email: 'Ad@Ornek.com' })).toEqual({
      email: 'ad@ornek.com',
    });
  });

  it.each(['12345', '1234567', '12a456', ' 123456'])('kod 6 rakam olmali (%j)', (code) => {
    const result = verifyEmailRequestSchema.safeParse({ email: 'ad@ornek.com', code });
    expect(result.success).toBe(false);
    expect(firstMessage(result)).toBe(VERIFICATION_CODE_MESSAGE);
  });

  it('gecerli dogrulama govdesini kabul eder', () => {
    expect(verifyEmailRequestSchema.parse({ email: 'ad@ornek.com', code: '042137' })).toEqual({
      email: 'ad@ornek.com',
      code: '042137',
    });
  });

  it('gonderim cevabi: sureler tam sayi, bekleme 0 olabilir', () => {
    const sent = { email: 'ad@ornek.com', expiresInSeconds: 600, resendAfterSeconds: 60 };
    expect(emailCodeSentSchema.parse(sent)).toEqual(sent);
    expect(emailCodeSentSchema.safeParse({ ...sent, resendAfterSeconds: 0 }).success).toBe(true);
    expect(emailCodeSentSchema.safeParse({ ...sent, expiresInSeconds: 0 }).success).toBe(false);
  });
});

describe('userProfileSchema (T11.14)', () => {
  const profile = { id: USER_ID, phone: '+905321234567', fullName: 'Ayşe Yılmaz' };

  it('e-postasiz profil gecerlidir: kullanici adres eklememis', () => {
    expect(userProfileSchema.parse(profile)).toEqual(profile);
  });

  it('dogrulanmis e-postayi tasir', () => {
    expect(userProfileSchema.parse({ ...profile, email: 'ayse@ornek.com' })).toEqual({
      ...profile,
      email: 'ayse@ornek.com',
    });
  });
});
