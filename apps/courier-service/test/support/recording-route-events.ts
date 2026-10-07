/**
 * RouteEventPublisher'in test kaydedicisi: yayinlanan kilometre taslari ve
 * istenirse bir sonraki yayinda hata (en az bir kez testleri).
 */

import type { Route } from '../../src/domain/route.js';
import type { RouteEventPublisher } from '../../src/domain/route-events.js';

export interface RecordedRouteEvent {
  readonly type: 'picked_up' | 'delivered';
  readonly orderId: string;
  readonly courierId: string;
  readonly marketId?: string;
  readonly at: Date;
}

export class RecordingRouteEvents implements RouteEventPublisher {
  readonly published: RecordedRouteEvent[] = [];
  private readonly failures = new Map<RecordedRouteEvent['type'], number>();

  /** Bu turdeki sonraki `count` yayin hata firlatir (hat yazilamadi). */
  failNext(type: RecordedRouteEvent['type'], count = 1): void {
    this.failures.set(type, count);
  }

  pickedUp(route: Route & { readonly marketId: string }, at: Date): Promise<void> {
    return this.record({
      type: 'picked_up',
      orderId: route.orderId,
      courierId: route.courierId,
      marketId: route.marketId,
      at,
    });
  }

  delivered(route: Route, at: Date): Promise<void> {
    return this.record({
      type: 'delivered',
      orderId: route.orderId,
      courierId: route.courierId,
      at,
    });
  }

  private record(event: RecordedRouteEvent): Promise<void> {
    const left = this.failures.get(event.type) ?? 0;
    if (left > 0) {
      this.failures.set(event.type, left - 1);
      return Promise.reject(new Error('hat yazilamadi'));
    }
    this.published.push(event);
    return Promise.resolve();
  }
}
