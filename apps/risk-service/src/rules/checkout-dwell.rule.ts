/**
 * checkout-dwell: rezervasyondan siparise 3 saniyeden kisa (bot hizi). Sure
 * SUNUCUDA olculur (B9); istemciden gelen bir sure kabul edilmez. Ilk
 * degerlendirmede (rezervasyon oncesi) sure yoktur ve kural tetiklenmez.
 */

import { MIN_CHECKOUT_DWELL_MS } from '../config/constants.js';
import type { Rule } from '../domain/rule.js';

export const checkoutDwellRule: Rule = {
  id: 'checkout-dwell',
  evaluate: ({ checkoutDwellMs }) => {
    if (checkoutDwellMs === undefined) {
      return Promise.resolve({ hit: false, reason: 'sure olculmedi' });
    }
    return Promise.resolve(
      checkoutDwellMs < MIN_CHECKOUT_DWELL_MS
        ? { hit: true, reason: `siparis ${checkoutDwellMs} ms icinde verildi` }
        : { hit: false, reason: `siparis ${checkoutDwellMs} ms icinde verildi` },
    );
  },
};
