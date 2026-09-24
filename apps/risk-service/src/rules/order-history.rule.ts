/**
 * order-history: hic teslim edilmis siparis yok YA DA iptal orani %50'nin
 * ustunde. Teslimat sayisi bilinmiyorsa (baglamda yok) tetiklenmez.
 */

import { MAX_CANCEL_RATIO } from '../config/constants.js';
import type { Rule } from '../domain/rule.js';

const PERCENT = 100;

export const orderHistoryRule: Rule = {
  id: 'order-history',
  evaluate: ({ deliveredOrderCount, cancelledOrderCount = 0 }) => {
    if (deliveredOrderCount === undefined) {
      return Promise.resolve({ hit: false, reason: 'siparis gecmisi bilinmiyor' });
    }
    if (deliveredOrderCount === 0) {
      return Promise.resolve({ hit: true, reason: 'hic teslim edilmis siparis yok' });
    }
    const ratio = cancelledOrderCount / (deliveredOrderCount + cancelledOrderCount);
    const percent = Math.round(ratio * PERCENT);
    return Promise.resolve(
      ratio > MAX_CANCEL_RATIO
        ? { hit: true, reason: `iptal orani %${percent}` }
        : { hit: false, reason: `iptal orani %${percent}` },
    );
  },
};
