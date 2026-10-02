/**
 * Kimlik semalari (T8.1): sifrede BAYT siniri, ad kirpma, oturum govdesi
 * (yenileme jetonu cerezde, govdede degil) ve cikis sonucu.
 */

import { describe, expect, it } from 'vitest';
import type { z } from 'zod';

import {
  PASSWORD_MAX_LENGTH,
  authSessionSchema,
  fullNameSchema,
  logoutResultSchema,
  passwordSchema,
  phoneSchema,
  registerRequestSchema,
  resetPasswordRequestSchema,
} from '../../src/index.js';

/** Semanin reddettigi degerin ilk mesaji: formun alanin altinda gosterdigi cumle. */
function messageOf(schema: z.ZodTypeAny, value: unknown): string | undefined {
  const result = schema.safeParse(value);
  return result.success ? undefined : result.error.issues[0]?.message;
}

describe('alan mesajlari kullaniciya gorunur: Turkce karakterli (T8.5 karari)', () => {
  // Web formu bu cumleleri alanin altinda gosterir; gateway ayni cumleleri doner
  // (rules_contract_test.go). Iki taraf birlikte ASCII'ye donse o test yesil
  // kalirdi; urun karari bu testte sabitlenir.
  it.each([
    [
      'Cep telefonu numarası 5 ile başlayan 10 rakam olmalı (örnek 532 123 45 67)',
      phoneSchema,
      '+90555',
    ],
    [
      'Cep telefonu numarası 5 ile başlayan 10 rakam olmalı (örnek 532 123 45 67)',
      phoneSchema,
      '+901231231312',
    ],
    ['en az 8 karakter olmalı', passwordSchema, 'kisa'],
    ['en fazla 72 bayt olmalı (Türkçe harfler iki bayt sayılır)', passwordSchema, 'ş'.repeat(37)],
    ['en az 2 karakter olmalı', fullNameSchema, ' A '],
    ['en fazla 80 karakter olmalı', fullNameSchema, 'a'.repeat(81)],
  ] as const)('"%s"', (message, schema, value) => {
    expect(messageOf(schema, value)).toBe(message);
  });
});

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

describe('phoneSchema: yalnizca Turkiye cep numarasi (T11.9; BTK: 5XX + 7 rakam)', () => {
  it.each(['+905321234567', '+905550000001', '+905011234567'])('%s kabul edilir', (phone) => {
    expect(phoneSchema.safeParse(phone).success).toBe(true);
  });

  it.each([
    ['sabit hat (Istanbul)', '+902121234567'],
    ['servis numarasi (0850)', '+908501234567'],
    ['1 ile baslayan', '+901231231312'],
    ['eksik rakam', '+90532123456'],
  ])('%s reddedilir', (_durum, phone) => {
    expect(phoneSchema.safeParse(phone).success).toBe(false);
  });
});

describe('resetPasswordRequestSchema (T11.9)', () => {
  it('telefon ve yeni sifre; kayittaki kurallar', () => {
    expect(
      resetPasswordRequestSchema.safeParse({ phone: '+905321234567', password: 'Yeni-Parola-2026' })
        .success,
    ).toBe(true);
    expect(
      resetPasswordRequestSchema.safeParse({ phone: '+902121234567', password: 'kisa' }).error
        ?.issues.length,
    ).toBe(2);
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
