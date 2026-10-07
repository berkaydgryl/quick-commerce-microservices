/**
 * Bagimlilik kurulumu - elle (DI framework yok).
 */

import { systemClock } from '@getir/core';
import type { Clock, Logger } from '@getir/core';
import { courierV1 } from '@getir/proto';
import type { GrpcServiceRegistration } from '@getir/service-kit';

import { createAdvanceRoute } from './application/advance-route.js';
import { createAdvanceRoutes } from './application/advance-routes.js';
import type { AdvanceRoutes } from './application/advance-routes.js';
import { createAssignCourier } from './application/assign-courier.js';
import { createAssignmentRoute } from './application/assignment-route.js';
import { createGetCourier } from './application/get-courier.js';
import { createGetTracking } from './application/get-tracking.js';
import { createNearestAvailableStrategy } from './application/nearest-available.js';
import { createReleaseCourier } from './application/release-courier.js';
import { createStartRoute } from './application/start-route.js';
import {
  COURIER_POOL_RADIUS_METERS,
  COURIER_PROXIMITY_BAND_METERS,
  COURIER_SERVICE_FULL_NAME,
  DEFAULT_COURIER_SPEED_KMH,
  DEFAULT_ORDER_PREP_SECONDS,
  ROUTE_MAX_POINTS,
  ROUTE_MIN_POINTS,
  ROUTE_POINT_SPACING_METERS,
  TICK_BATCH_SIZE,
} from './config/constants.js';
import type { CourierBatchReader, CourierRepository } from './domain/courier-repository.js';
import type { LiveLocationStore } from './domain/live-location.js';
import type { MarketLocator } from './domain/market-locator.js';
import type { RouteEventPublisher } from './domain/route-events.js';
import type { MovingRouteRepository, RouteRepository } from './domain/route-repository.js';
import { MARKET_LOCATION_SEEDS } from './infrastructure/fixtures/couriers.js';
import { InMemoryCourierStore } from './infrastructure/memory/in-memory-courier-store.js';
import { InMemoryRouteStore } from './infrastructure/memory/in-memory-route-store.js';
import { createCourierImplementation } from './interfaces/grpc/courier-handlers.js';

export interface BootstrapOptions {
  readonly logger?: Logger;
  /** couriers deposu; main.ts openCourierStore'dan verir. Verilmezse bos bellek (testler). */
  readonly couriers?: CourierRepository;
  /**
   * Market konumu kopyasi (T13.2); main.ts openCourierStore'dan verir.
   * Verilmezse demo marketleri bellekte (testler).
   */
  readonly markets?: MarketLocator;
  /** Rotalar (T13.2); main.ts openCourierStore'dan verir. Verilmezse bos bellek (testler). */
  readonly routes?: RouteRepository;
  /**
   * Rotayi bitirebilen depo (T13.3): ReleaseCourier rotayi ENDED yazar. main.ts
   * `routes` ile ayni depoyu verir. Verilmezse: `routes` da verilmediyse ayni
   * bellek deposu, verildiyse yok (rota tick'te biter).
   */
  readonly movingRoutes?: RouteRepository & MovingRouteRepository;
  /** Kurye hizi (km/sa), varis tahmini icin; main.ts ortamdan (COURIER_SPEED_KMH) verir. */
  readonly speedKmh?: number;
  /** Markette hazirlanma suresi (sn, T13.3 takip); main.ts ortamdan (ORDER_PREP_SECONDS) verir. */
  readonly prepSeconds?: number;
  /** Saat; testte sabitlenebilsin diye disaridan verilebilir. */
  readonly clock?: Clock;
}

export function buildCourierService(options: BootstrapOptions = {}): GrpcServiceRegistration {
  const logger = options.logger;
  const clock = options.clock ?? systemClock;
  const repository = options.couriers ?? new InMemoryCourierStore();
  const markets = options.markets ?? new InMemoryCourierStore([], MARKET_LOCATION_SEEDS);
  const memoryRoutes = new InMemoryRouteStore();
  const routes = options.routes ?? memoryRoutes;
  const movingRoutes =
    options.movingRoutes ?? (options.routes === undefined ? memoryRoutes : undefined);
  const speedKmh = options.speedKmh ?? DEFAULT_COURIER_SPEED_KMH;

  // Use-case'ler gunlukcuyu bagimlilik olarak ALMAZ: her cagrida handler'in
  // requestId bagli gunlukcusu gecer (ctx.logger).
  return {
    name: COURIER_SERVICE_FULL_NAME,
    definition: courierV1.CourierServiceService,
    implementation: createCourierImplementation({
      assignCourier: createAssignCourier({
        repository,
        markets,
        strategy: createNearestAvailableStrategy(repository, {
          radiusMeters: COURIER_POOL_RADIUS_METERS,
          bandMeters: COURIER_PROXIMITY_BAND_METERS,
        }),
        route: createAssignmentRoute({
          routes,
          markets,
          rule: {
            spacingMeters: ROUTE_POINT_SPACING_METERS,
            minPoints: ROUTE_MIN_POINTS,
            maxPoints: ROUTE_MAX_POINTS,
            speedKmh,
          },
          clock,
        }),
        clock,
      }),
      getCourier: createGetCourier(repository),
      releaseCourier: createReleaseCourier({
        couriers: repository,
        ...(movingRoutes === undefined ? {} : { routes: movingRoutes }),
        clock,
      }),
      startRoute: createStartRoute(routes, repository),
      getTracking: createGetTracking({
        routes,
        couriers: repository,
        rule: { speedKmh, prepSeconds: options.prepSeconds ?? DEFAULT_ORDER_PREP_SECONDS },
        clock,
      }),
      ...(logger === undefined ? {} : { logger }),
    }),
  };
}

export interface AdvanceRoutesOptions {
  readonly routes: MovingRouteRepository;
  readonly couriers: Pick<CourierRepository, 'releaseByOrder'> & CourierBatchReader;
  readonly events: RouteEventPublisher;
  readonly live: LiveLocationStore;
  /** GetTracking ile AYNI kural: tick ve takip ayni ani gorur. */
  readonly speedKmh?: number;
  readonly prepSeconds?: number;
  readonly clock?: Clock;
}

/** Tick turu (T13.3): ilerleyen rotalari bu ana getirir; isci main.ts'te baslar. */
export function buildAdvanceRoutes(options: AdvanceRoutesOptions): AdvanceRoutes {
  return createAdvanceRoutes({
    routes: options.routes,
    couriers: options.couriers,
    advance: createAdvanceRoute({
      routes: options.routes,
      couriers: options.couriers,
      events: options.events,
      live: options.live,
      rule: {
        speedKmh: options.speedKmh ?? DEFAULT_COURIER_SPEED_KMH,
        prepSeconds: options.prepSeconds ?? DEFAULT_ORDER_PREP_SECONDS,
      },
      clock: options.clock ?? systemClock,
    }),
    batchSize: TICK_BATCH_SIZE,
  });
}
