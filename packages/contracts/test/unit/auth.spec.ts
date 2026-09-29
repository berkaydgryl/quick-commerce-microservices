/**
 * Kimlik semalari (T8.1): sifrede BAYT siniri, ad kirpma, oturumda yenileme
 * jetonu ve yenileme/cikis istekleri.
 */

import { describe, expect, it } from 'vitest';

import {
  PASSWORD_MAX_LENGTH,
  authSessionSchema,
  logoutRequestSchema,
  logoutResultSchema,
  passwordSchema,
  refreshRequestSchema,
  registerRequestSchema,
} from '../../src/index.js';

describe('passwordSchema: ust sinir BAYT (bcrypt ilk 72 bayti kullanir)', () => {
  it(`${PASSWORD_MAX_LENGTH} ASCII karakter gecer, bir fazlasi gecmez`, () => {
    expect(passwordSchema.safeParse('a'.repeat(PASSWORD_MAX_LENGTH)).success).toBe(true);
    expect(passwordSchema.safeParse('a'.repeat(PASSWORD_MAX_LENGTH + 1)).success).toBe(false);
  });

  it('Turkce harf iki bayt sayilir: 36 "ş" gecer, 37 gecmez', () => {
    expect(passwordSchema.safeParse('ş'.repeat(36)).success).toBe(true);
    expect(passwordSchema.safeParse('ş'.repeat(37)).success).toBe(false);
  });

  it('en az 8 karakter', () => {
    expect(passwordSchema.safeParse('kisa123').success).toBe(false);
    expect(passwordSchema.safeParse('uzun1234').success).toBe(true);
  });
});

describe('registerRequestSchema', () => {
  const valid = { phone: '+905321234567', password: 'sifre1234', fullName: '  Ayşe Yılmaz  ' };

  it('ad kirpilir', () => {
    expect(registerRequestSchema.parse(valid).fullName).toBe('Ayşe Yılmaz');
  });

  it('yalnizca bosluktan olusan ad reddedilir', () => {
    expect(registerRequestSchema.safeParse({ ...valid, fullName: '   ' }).success).toBe(false);
  });
});

describe('oturum ve yenileme', () => {
  const session = {
    accessToken: 'eyJ.x.y',
    tokenType: 'Bearer',
    expiresIn: 3600,
    refreshToken: 'opak-jeton',
    refreshExpiresIn: 1_209_600,
    user: { id: 'usr_0123456789abcdef0123456789abcdef', phone: '+905321234567', fullName: 'Ayşe' },
  };

  it('oturum yenileme jetonunu ve omrunu TASIR', () => {
    expect(authSessionSchema.safeParse(session).success).toBe(true);
    const { refreshToken: _token, ...withoutRefresh } = session;
    expect(authSessionSchema.safeParse(withoutRefresh).success).toBe(false);
  });

  it('yenileme ve cikis istegi dolu jeton ister', () => {
    expect(refreshRequestSchema.safeParse({ refreshToken: '  ' }).success).toBe(false);
    expect(logoutRequestSchema.parse({ refreshToken: ' opak ' }).refreshToken).toBe('opak');
  });

  it('cikis sonucu: revoked false hata degildir', () => {
    expect(logoutResultSchema.parse({ revoked: false })).toEqual({ revoked: false });
  });
});
