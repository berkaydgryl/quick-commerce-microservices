import { describe, expect, it, vi } from 'vitest';

import { focusFirstInvalid, showServerErrors } from '../../src/features/auth/ui/form-errors';

interface Form {
  fullName: string;
  phone: string;
  password: string;
}

const ON_SCREEN = ['fullName', 'phone', 'password'] as const;

describe('kimlik formlarinda odak sirasi (T8.5)', () => {
  it('odak ekrandaki siraya gore ilk hatali alana gider, hata nesnesinin sirasina degil', () => {
    const setFocus = vi.fn();
    // react-hook-form'un sirasi: sifre telefondan once kaydoldu (Controller sonra).
    const errors = { password: { type: 'min' }, phone: { type: 'regex' } };

    focusFirstInvalid<Form>(ON_SCREEN, errors, setFocus);

    expect(setFocus).toHaveBeenCalledTimes(1);
    expect(setFocus).toHaveBeenCalledWith('phone');
  });

  it('hata yoksa odak degismez', () => {
    const setFocus = vi.fn();

    focusFirstInvalid<Form>(ON_SCREEN, {}, setFocus);

    expect(setFocus).not.toHaveBeenCalled();
  });

  it('sunucu mesajlari alanlara yazilir; yalnizca sirayla ilki odak alir', () => {
    const setError = vi.fn();

    showServerErrors<Form>(
      ON_SCREEN,
      { password: 'sifre sebebi', phone: 'telefon sebebi' },
      setError,
    );

    expect(setError.mock.calls).toEqual([
      ['phone', { type: 'server', message: 'telefon sebebi' }, { shouldFocus: true }],
      ['password', { type: 'server', message: 'sifre sebebi' }, { shouldFocus: false }],
    ]);
  });
});
