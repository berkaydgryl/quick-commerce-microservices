/**
 * basket-anomaly: sepet, kullanicinin ortalamasinin 3 katindan buyuk.
 * Ortalama bilinmiyorsa (ilk siparis) karsilastirilacak bir sey yoktur.
 */

import { BASKET_ANOMALY_MULTIPLIER } from '../config/constants.js';
import type { Rule } from '../domain/rule.js';

const ONE_DECIMAL = 10;

export const basketAnomalyRule: Rule = {
  id: 'basket-anomaly',
  evaluate: ({ basketTotalMinor, userAverageBasketMinor }) => {
    if (
      basketTotalMinor === undefined ||
      userAverageBasketMinor === undefined ||
      userAverageBasketMinor <= 0
    ) {
      return Promise.resolve({ hit: false, reason: 'karsilastirilacak ortalama yok' });
    }
    const times =
      Math.round((basketTotalMinor / userAverageBasketMinor) * ONE_DECIMAL) / ONE_DECIMAL;
    return Promise.resolve(
      basketTotalMinor > userAverageBasketMinor * BASKET_ANOMALY_MULTIPLIER
        ? { hit: true, reason: `sepet ortalamanin ${times} kati` }
        : { hit: false, reason: `sepet ortalamanin ${times} kati` },
    );
  },
};
