import { describe, expect, it } from 'vitest';

import { readAuthRouteState } from '../../src/features/auth/services/auth-route-state';

describe('giris/kayit penceresinin gecmis durumu (T11.6)', () => {
  it('numara ve uygulama ici acilis okunur; demo isareti yoksa false', () => {
    const phoneEntry = { dialCode: '+90', digits: '5321234567' };
    expect(readAuthRouteState({ phoneEntry, fromApp: true })).toEqual({
      phoneEntry,
      fromApp: true,
      demo: false,
    });
  });

  it('demo hesabiyla acilis isareti okunur; sifre durumda tasinmaz', () => {
    const phoneEntry = { dialCode: '+90', digits: '5550000001' };
    const read = readAuthRouteState({ phoneEntry, fromApp: true, demo: true });
    expect(read).toEqual({ phoneEntry, fromApp: true, demo: true });
    expect(Object.keys(read)).not.toContain('password');
  });

  it.each([null, undefined, 'metin', 5, {}])('durum yoksa varsayilan: %j', (state) => {
    expect(readAuthRouteState(state)).toEqual({ phoneEntry: null, fromApp: false, demo: false });
  });

  it('bicimsiz alan tek basina yok sayilir, digerleri okunur', () => {
    expect(readAuthRouteState({ phoneEntry: { dialCode: '+90' }, fromApp: true })).toEqual({
      phoneEntry: null,
      fromApp: true,
      demo: false,
    });
    expect(
      readAuthRouteState({
        phoneEntry: { dialCode: '+90', digits: '5' },
        fromApp: 'evet',
        demo: 'evet',
      }),
    ).toEqual({ phoneEntry: { dialCode: '+90', digits: '5' }, fromApp: false, demo: false });
  });
});
