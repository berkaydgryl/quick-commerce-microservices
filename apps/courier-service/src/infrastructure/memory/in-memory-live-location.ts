/**
 * LiveLocationStore'un bellek uygulamasi (MOCK ve testler): sure tutulmaz,
 * son yazilan konum kalir.
 */

import type { LiveLocation, LiveLocationStore } from '../../domain/live-location.js';

export class InMemoryLiveLocationStore implements LiveLocationStore {
  private readonly locations = new Map<string, LiveLocation>();

  save(courierId: string, live: LiveLocation): Promise<void> {
    this.locations.set(courierId, live);
    return Promise.resolve();
  }

  find(courierId: string): Promise<LiveLocation | null> {
    return Promise.resolve(this.locations.get(courierId) ?? null);
  }
}
