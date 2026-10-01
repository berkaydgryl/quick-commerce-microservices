/**
 * Bellekteki liderlik (MOCK=true, B16): tek surec vardir, kilit hep bizdedir.
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
