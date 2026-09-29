import { describe, expect, it } from 'vitest';

import {
  formatNationalPhone,
  formatPhone,
  fromE164,
  nationalDigits,
  toE164,
} from '../../src/features/auth/services/phone';

describe('telefon alani (T8.5)', () => {
  it.each([
    ['532 123 45 67', '5321234567'],
    ['+90 532 123 45 67', '5321234567'],
    ['0532 123 45 67', '5321234567'],
    ['905321234567', '5321234567'],
    ['+90 0532 123 45 67', '5321234567'],
    ['53212345678999', '5321234567'],
    ['0', ''],
    ['05', '5'],
    ['5a3b2', '532'],
  ])('%s -> %s', (input, digits) => {
    expect(nationalDigits(input)).toBe(digits);
  });

  it('10 rakamlik ulusal numara "90" ile baslasa da kirpilmaz', () => {
    expect(nationalDigits('9053212345')).toBe('9053212345');
  });

  it.each([
    ['', ''],
    ['5', '5'],
    ['532', '532'],
    ['5321', '532 1'],
    ['53212345', '532 123 45'],
    ['5321234567', '532 123 45 67'],
  ])('%s gosterimi "%s"', (digits, shown) => {
    expect(formatNationalPhone(digits)).toBe(shown);
  });

  it('gosterim yeniden rakama doner: yazarken bicim kaybolmaz', () => {
    expect(nationalDigits(formatNationalPhone('5321234567'))).toBe('5321234567');
  });

  it('E.164 ile gidip gelir ve profilde okunur gosterilir', () => {
    expect(toE164('5321234567')).toBe('+905321234567');
    expect(fromE164('+905321234567')).toBe('5321234567');
    expect(formatPhone('+905550000001')).toBe('+90 555 000 00 01');
  });
});
