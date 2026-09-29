/**
 * Kimlik semalari (T8.1): sifrede BAYT siniri, ad kirpma, oturum govdesi
 * (yenileme jetonu cerezde, govdede degil) ve cikis sonucu.
 */

import { describe, expect, it } from 'vitest';

import {
  PASSWORD_MAX_LENGTH,
  authSessionSchema,
  logoutResultSchema,
  passwordSchema,
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

describe('oturum', () => {
  const session = {
    accessToken: 'eyJ.x.y',
    tokenType: 'Bearer',
    expiresIn: 3600,
    refreshExpiresIn: 1_209_600,
    user: { id: 'usr_0123456789abcdef0123456789abcdef', phone: '+905321234567', fullName: 'Ayşe' },
  };

  it('oturum govdesi erisim jetonunu ve yenilemenin OMRUNU tasir, jetonun kendisini DEGIL', () => {
    // Yenileme jetonu HttpOnly cerezdedir; sema onu tanimaz, gelse bile atar.
    expect(authSessionSchema.safeParse(session).success).toBe(true);
    expect('refreshToken' in authSessionSchema.shape).toBe(false);
    expect(authSessionSchema.parse({ ...session, refreshToken: 'sizmamali' })).not.toHaveProperty(
      'refreshToken',
    );
  });

  it('cikis sonucu: revoked false hata degildir', () => {
    expect(logoutResultSchema.parse({ revoked: false })).toEqual({ revoked: false });
  });
});
