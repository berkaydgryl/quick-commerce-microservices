/**
 * LeaderLock'un bellek uygulamasi (MOCK): tek ornek, hep lider.
 */

import type { LeaderLock } from '../../domain/leader-lock.js';

export class InMemoryLeaderLock implements LeaderLock {
  hold(): Promise<boolean> {
    return Promise.resolve(true);
  }

  release(): Promise<void> {
    return Promise.resolve();
  }
}
