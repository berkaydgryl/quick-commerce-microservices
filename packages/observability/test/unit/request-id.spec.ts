import { describe, expect, it } from 'vitest';

import {
  acceptRequestId,
  REQUEST_ID_METADATA_KEY,
  resolveRequestId,
} from '../../src/request-id.js';

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

describe('acceptRequestId (dis kapi, #22)', () => {
  const valid = 'req_0123456789abcdef0123456789abcdef';

  it('bicime uyan kimligi oldugu gibi korur', () => {
    expect(acceptRequestId(valid)).toBe(valid);
  });

  it.each([
    ['bosluklu', ` ${valid} `],
    ['buyuk harfli', 'req_0123456789ABCDEF0123456789ABCDEF'],
    ['kisa govde', 'req_0123'],
    ['baska onek', 'ord_0123456789abcdef0123456789abcdef'],
    ['serbest metin', 'istemcinin-uydurdugu-kimlik'],
    ['cok uzun', `req_${'a'.repeat(4096)}`],
    ['bos', ''],
    ['metin degil', 42],
    ['yok', undefined],
  ])('%s degeri reddeder ve yenisini uretir', (_name, incoming) => {
    const accepted = acceptRequestId(incoming);
    expect(accepted).toMatch(/^req_[0-9a-f]{32}$/);
    expect(accepted).not.toBe(incoming);
  });
});
