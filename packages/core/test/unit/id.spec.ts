import { describe, expect, it } from 'vitest';

import { ID_PREFIX, isId, newId } from '../../src/index.js';

const SAMPLE_SIZE = 500;
const UUID_HEX_LENGTH = 32;

describe('newId', () => {
  it('kimligi onek ile uretir', () => {
    const orderId = newId(ID_PREFIX.ORDER);
    expect(orderId.startsWith(`${ID_PREFIX.ORDER}_`)).toBe(true);
    expect(orderId.slice(ID_PREFIX.ORDER.length + 1)).toHaveLength(UUID_HEX_LENGTH);
  });

  it('tum onekler icin calisir', () => {
    for (const prefix of Object.values(ID_PREFIX)) {
      expect(isId(prefix, newId(prefix))).toBe(true);
    }
  });

  it('uretilen kimlikler benzersizdir', () => {
    const ids = new Set<string>();
    for (let index = 0; index < SAMPLE_SIZE; index += 1) {
      ids.add(newId(ID_PREFIX.RESERVATION));
    }
    expect(ids.size).toBe(SAMPLE_SIZE);
  });
});

describe('isId', () => {
  it('yanlis onegi reddeder', () => {
    const userId = newId(ID_PREFIX.USER);
    expect(isId(ID_PREFIX.USER, userId)).toBe(true);
    expect(isId(ID_PREFIX.ORDER, userId)).toBe(false);
  });

  it('bozuk govdeyi reddeder', () => {
    expect(isId(ID_PREFIX.ORDER, 'ord_')).toBe(false);
    expect(isId(ID_PREFIX.ORDER, 'ord_not-a-uuid')).toBe(false);
    expect(isId(ID_PREFIX.ORDER, `ord_${'A'.repeat(UUID_HEX_LENGTH)}`)).toBe(false);
    expect(isId(ID_PREFIX.ORDER, 'ord')).toBe(false);
  });

  it('string olmayan degeri reddeder', () => {
    expect(isId(ID_PREFIX.PAYMENT, undefined)).toBe(false);
    expect(isId(ID_PREFIX.PAYMENT, null)).toBe(false);
    expect(isId(ID_PREFIX.PAYMENT, 123)).toBe(false);
    expect(isId(ID_PREFIX.PAYMENT, {})).toBe(false);
  });
});
