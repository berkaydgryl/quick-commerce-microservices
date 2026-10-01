import { describe, expect, it } from 'vitest';

import { REQUEST_ID_METADATA_KEY, resolveRequestId } from '../../src/request-id.js';

describe('resolveRequestId', () => {
  it('gelen kimligi bas/son bosluksuz kullanir', () => {
    expect(resolveRequestId('  req_0123456789abcdef0123456789abcdef ')).toBe(
      'req_0123456789abcdef0123456789abcdef',
    );
  });

  it.each([undefined, '', '   ', 42, Buffer.from('req_ikili')])(
    'gelen deger yok ya da metin degilse (%s) yenisini uretir',
    (incoming) => {
      expect(resolveRequestId(incoming)).toMatch(/^req_[0-9a-f]{32}$/);
    },
  );

  it('her uretim farkli kimlik verir', () => {
    expect(resolveRequestId(undefined)).not.toBe(resolveRequestId(undefined));
  });

  it("anahtar gateway'in okudugu kucuk harfli baslik", () => {
    expect(REQUEST_ID_METADATA_KEY).toBe('x-request-id');
  });
});
