/**
 * Bugunku secim kurali: marketin en uzun suredir is almamis IDLE kuryesi.
 * Sec ve isaretle deponun tek atomik adimidir (B7); burada yalnizca hangi
 * adimin kullanilacagi secilir.
 */

import type { AssignmentStrategy } from '../domain/assignment-strategy.js';
import type { CourierRepository } from '../domain/courier-repository.js';

export const LEAST_RECENTLY_ASSIGNED = 'least-recently-assigned';

export function createLeastRecentlyAssignedStrategy(
  repository: CourierRepository,
): AssignmentStrategy {
  return {
    name: LEAST_RECENTLY_ASSIGNED,
    claim: ({ orderId, marketId, at }) =>
      repository.claimLeastRecentlyAssigned({ orderId, marketId, at }),
  };
}
