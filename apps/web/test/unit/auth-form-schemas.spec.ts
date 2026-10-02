import {
  fullNameSchema,
  loginRequestSchema,
  passwordSchema,
  phoneSchema,
  registerRequestSchema,
} from '@getir/contracts';
import { describe, expect, it } from 'vitest';
import type { z } from 'zod';

import {
  completePhone,
  loginFormSchema,
  phoneEntrySchema,
  registerFormSchema,
} from '../../src/features/auth/services/form-schemas';

/** Sozlesme semasinin verdigi ilk mesaj: formun gostermesi gereken cumle. */
function contractMessage(schema: z.ZodTypeAny, value: unknown): string | undefined {
  const result = schema.safeParse(value);
  return result.success ? undefined : result.error.issues[0]?.message;
}

function fieldMessages(result: z.SafeParseReturnType<unknown, unknown>) {
  return result.success ? {} : result.error.flatten().fieldErrors;
}

describe('kimlik formlarinin semalari (T8.5, T11.6)', () => {
  it('karsilama karti: 10 rakam secili ulkenin koduyla E.164 olur', () => {
    const result = phoneEntrySchema('+90').safeParse({ phone: '5550000001' });
    expect(result.success && result.data).toEqual({ phone: '+905550000001' });
  });

  it('giris: cikti sozlesmenin istegidir', () => {
    const result = loginFormSchema('+90').safeParse({
      phone: '5550000001',
      password: 'Demo-Persona-2026',
    });

    expect(result.success && result.data).toEqual({
      phone: '+905550000001',
      password: 'Demo-Persona-2026',
    });
    expect(loginRequestSchema.safeParse(result.success && result.data).success).toBe(true);
  });

  it('eksik telefon ve kisa sifre sozlesmenin mesajlariyla doner', () => {
    const result = loginFormSchema('+90').safeParse({ phone: '555', password: 'kisa' });

    expect(fieldMessages(result)).toEqual({
      phone: [contractMessage(phoneSchema, '+90555')],
      password: [contractMessage(passwordSchema, 'kisa')],
    });
  });

  it('sozlesmenin kabul etmedigi ulke kodu formda reddedilir (PHONE_PATTERN yalnizca +90)', () => {
    expect(phoneEntrySchema('+49').safeParse({ phone: '5550000001' }).success).toBe(false);
  });

  it('bos kayit formu: her alan kendi mesajini alir (ayri "zorunlu" metni yok)', () => {
    const result = registerFormSchema('+90').safeParse({ fullName: '', phone: '', password: '' });

    expect(Object.keys(fieldMessages(result)).sort()).toEqual(['fullName', 'password', 'phone']);
  });

  it('kayit: ad kirpilir, cikti sozlesmenin istegidir', () => {
    const result = registerFormSchema('+90').safeParse({
      fullName: '  Ayşe Yılmaz  ',
      phone: '5550000001',
      password: 'Demo-Persona-2026',
    });

    expect(result.success && result.data).toEqual({
      fullName: 'Ayşe Yılmaz',
      phone: '+905550000001',
      password: 'Demo-Persona-2026',
    });
    expect(registerRequestSchema.safeParse(result.success && result.data).success).toBe(true);
  });

  it('tek harfli ad sozlesmenin mesajiyla reddedilir', () => {
    const result = registerFormSchema('+90').safeParse({
      fullName: 'A',
      phone: '5550000001',
      password: 'Demo-Persona-2026',
    });

    expect(fieldMessages(result)).toEqual({ fullName: [contractMessage(fullNameSchema, 'A')] });
  });

  it('tamamlanmis numara (T11.7): yalnizca sozlesmeye uyan numara E.164 olur, eksigi null', () => {
    expect(completePhone('5550000001', '+90')).toBe('+905550000001');
    expect(completePhone('555000000', '+90')).toBeNull();
    expect(completePhone('', '+90')).toBeNull();
    expect(completePhone('5550000001', '+49')).toBeNull();
  });
});
