/**
 * Rota <-> Mongo belgesi eslemesi (#197): hareket kurali yazilir ve okunur;
 * kurali olmayan (#197 oncesi) rota ve belgede alan HIC yazilmaz.
 */

import { describe, expect, it } from 'vitest';

import type { Route } from '../../src/domain/route.js';
import { planRoute } from '../../src/domain/route-planner.js';
import type { RouteDocument } from '../../src/infrastructure/mongo/documents.js';
import { fromRouteDocument, toRouteDocument } from '../../src/infrastructure/mongo/mappers.js';
import {
  courierId,
  DELIVERY,
  MARKET_LOCATION,
  MOVEMENT_RULE,
  northOf,
  NOW_MS,
  orderId,
  ROUTE_RULE,
} from '../support/couriers.js';

function plannedRoute(): Route {
  return {
    orderId: orderId(),
    courierId: courierId(1),
    ...planRoute(
      { from: northOf(MARKET_LOCATION, 640), pickup: MARKET_LOCATION, dropoff: DELIVERY },
      ROUTE_RULE,
    ),
    createdAt: new Date(NOW_MS),
  };
}

describe('rota eslemesi: hareket kurali (#197)', () => {
  it('kural belgeye yazilir ve aynen okunur', () => {
    const route = { ...plannedRoute(), movement: MOVEMENT_RULE };

    const document = toRouteDocument(route);

    expect(document.movement).toEqual(MOVEMENT_RULE);
    expect(fromRouteDocument(document)).toEqual(route);
  });

  it.each([
    ['null', null],
    ['hiz 0', { speedKmh: 0, prepSeconds: 30 }],
    ['negatif hazirlik', { speedKmh: 20, prepSeconds: -1 }],
    ['hazirlik yok', { speedKmh: 20 }],
    ['metin hiz', { speedKmh: '20', prepSeconds: 30 }],
  ])(
    'bozuk belge kurali (%s) YOK sayilir: rota o anki ayarla ilerler, okuma dusmez',
    (_case, movement) => {
      const document = { ...toRouteDocument(plannedRoute()), movement } as unknown as RouteDocument;

      expect(fromRouteDocument(document)).not.toHaveProperty('movement');
    },
  );

  it('kurali olmayan eski rota: belgede de rotada da alan yok (o anki ayar)', () => {
    const route = plannedRoute();

    const document = toRouteDocument(route);

    expect(document).not.toHaveProperty('movement');
    expect(fromRouteDocument(document)).not.toHaveProperty('movement');
    expect(fromRouteDocument(document)).toEqual(route);
  });
});
