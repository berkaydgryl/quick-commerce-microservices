/**
 * withoutRandomNoise (T11.17, #132): rastgele kimlik ve alan degerleri
 * maskelenir; sizan sir (kart numarasi, CVV) gorunur kalir.
 */

import { describe, expect, it } from 'vitest';

import { MASKED_ID, MASKED_VALUE, withoutRandomNoise } from '../../src/testing/index.js';

/** #132'nin CI'da dusen satirindaki istek kimligi: icinde tesadufen "9183" var. */
const CI_REQUEST_ID = 'req_8b21ab37ec584a9183af1f3aa53152d7';

describe('withoutRandomNoise', () => {
  it("CI'daki dize: ham metin CVV'yi tesadufen 'icerir', maskelenmis metin icermez", () => {
    const line = JSON.stringify({ requestId: CI_REQUEST_ID, rpc: 'AddCard', durationMs: 0.91834 });

    expect(line).toContain('9183');
    expect(withoutRandomNoise(line)).not.toContain('9183');
    expect(withoutRandomNoise(line)).toBe(
      `{"requestId":"${MASKED_ID}","rpc":"AddCard","durationMs":"${MASKED_VALUE}"}`,
    );
  });

  it('butun onekli kimlikler ve bilinen rastgele alanlar maskelenir', () => {
    const text = JSON.stringify({
      cardId: 'crd_0123456789abcdef0123456789abcdef',
      userId: 'usr_fedcba9876543210fedcba9876543210',
      time: '2026-10-05T12:00:09.183Z',
      pid: 9183,
      hostname: 'runner-9183',
      port: 59183,
      traceId: '0af7651916cd43dd8448eb211c80319c',
      spanId: 'b7ad6b7169203331',
    });

    expect(withoutRandomNoise(text)).not.toMatch(/[0-9]/);
  });

  it('SIZINTI GORUNUR KALIR: kart numarasi, CVV degeri, oneksiz onaltilik ve jeton maskelenmez', () => {
    const text = JSON.stringify({
      number: '4242424242424242',
      cvv: '9183',
      note: 'kart 3782 822463 10005',
      hex: '8b21ab37ec584a9183af1f3aa53152d7',
      providerToken: 'tok_test_4242',
    });

    expect(withoutRandomNoise(text)).toBe(text);
  });
});
