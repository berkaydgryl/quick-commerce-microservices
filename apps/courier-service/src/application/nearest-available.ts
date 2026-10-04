/**
 * Bugunku secim kurali (T13.2): siparisin marketinin cevresindeki havuzdan,
 * en yakin dilimde en uzun suredir bos kurye (domain/courier-pool.ts). Sec ve
 * isaretle deponun atomik adimidir (B7); burada yalnizca kural verilir.
 */

import type { AssignmentStrategy } from '../domain/assignment-strategy.js';
import type { PoolRule } from '../domain/courier-pool.js';
import type { CourierRepository } from '../domain/courier-repository.js';

export const NEAREST_AVAILABLE = 'nearest-available';

export function createNearestAvailableStrategy(
  repository: CourierRepository,
  rule: PoolRule,
): AssignmentStrategy {
  return {
    name: NEAREST_AVAILABLE,
    claim: ({ orderId, marketLocation, at }) =>
      repository.claimNearest({ orderId, near: marketLocation, rule, at }),
  };
}
