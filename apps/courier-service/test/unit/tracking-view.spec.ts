/**
 * Takibin gosterimi (saf; tracking-view.ts), #190: kayitli kilometre tasi x
 * hesaplanan asama matrisi. DELIVERED'da iki an HER ZAMAN var ve alma <= teslim;
 * kalan yol ve tahmin 0, konum adres. Her cikti @getir/contracts
 * orderTrackingSchema'dan gecer.
 */

import { orderTrackingSchema } from '@getir/contracts';
import { describe, expect, it } from 'vitest';

import type { Route } from '../../src/domain/route.js';
import { planRoute } from '../../src/domain/route-planner.js';
import type { RouteProgress } from '../../src/domain/route-progress.js';
import { routeLegs, TRACKING_PHASE } from '../../src/domain/route-progress.js';
import { trackingView } from '../../src/domain/tracking-view.js';
import {
  courierId,
  DELIVERY,
  MARKET_LOCATION,
  northOf,
  NOW_MS,
  orderId,
  ROUTE_RULE,
} from '../support/couriers.js';
import { toRest } from '../support/tracking-rest.js';

const at = (seconds: number) => new Date(NOW_MS + seconds * 1_000);

const ROUTE = planRoute(
  { from: northOf(MARKET_LOCATION, 900), pickup: MARKET_LOCATION, dropoff: DELIVERY },
  ROUTE_RULE,
);
const LEG_TWO = routeLegs(ROUTE).legTwo;

/** Hesaplanan ilerleme (routeProgress'in uretecegi bicim), asama basina. */
const PROGRESS = {
  TO_MARKET: {
    phase: TRACKING_PHASE.TO_MARKET,
    position: northOf(MARKET_LOCATION, 400),
    legTwoRemainingMeters: 1_200,
    etaSeconds: 437,
  },
  TO_CUSTOMER: {
    phase: TRACKING_PHASE.TO_CUSTOMER,
    position: LEG_TWO[1] ?? DELIVERY,
    legTwoRemainingMeters: 500,
    etaSeconds: 50,
    pickedUpAt: at(60),
  },
  DELIVERED: {
    phase: TRACKING_PHASE.DELIVERED,
    position: DELIVERY,
    legTwoRemainingMeters: 0,
    etaSeconds: 0,
    pickedUpAt: at(60),
    deliveredAt: at(120),
  },
} satisfies Record<string, RouteProgress>;

/** Kayitli kilometre taslari (tick'in yazdiklari ve savunma durumlari). */
type Recorded = Pick<Route, 'pickedUpAt' | 'deliveredAt'>;

const LATE_PICKUP: Recorded = { pickedUpAt: at(600) };

const RECORDED: Readonly<Record<string, Recorded>> = {
  'kayit yok': {},
  'alma kayitli': { pickedUpAt: at(70) },
  'alma kayitli (eski yavas ayarla, gec)': LATE_PICKUP,
  'alma ve teslim kayitli': { pickedUpAt: at(70), deliveredAt: at(130) },
  'yalniz teslim kayitli (yazicisi yok; savunma)': { deliveredAt: at(130) },
};

function view(recorded: Recorded, progress: RouteProgress) {
  return trackingView({ ...ROUTE, ...recorded }, progress);
}

describe('trackingView: kayit x hesap matrisi (#190)', () => {
  for (const [recordedName, recorded] of Object.entries(RECORDED)) {
    for (const [progressName, progress] of Object.entries(PROGRESS)) {
      it(`${recordedName} x hesap ${progressName}: sozlesme; DELIVERED ise iki an, alma <= teslim, kalanlar 0`, () => {
        const result = view(recorded, progress);

        const rest = toRest(orderId(), {
          ...result,
          courierId: courierId(1),
          courierName: 'Mehmet K.',
          at: at(900),
        });
        const parsed = orderTrackingSchema.safeParse(rest);
        expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
        if (result.phase === TRACKING_PHASE.DELIVERED) {
          expect(result).toMatchObject({ location: DELIVERY, remainingMeters: 0, etaSeconds: 0 });
          const pickedUpAt = result.pickedUpAt?.getTime() ?? Number.NaN;
          const deliveredAt = result.deliveredAt?.getTime() ?? Number.NaN;
          expect(pickedUpAt).toBeLessThanOrEqual(deliveredAt);
        }
      });
    }
  }

  it('karisik kaynak: eski ayarla gec kayitli alma + yeni ayarla erken hesaplanan teslim -> teslim = alma', () => {
    const result = view(LATE_PICKUP, PROGRESS.DELIVERED);

    expect(result).toMatchObject({
      phase: TRACKING_PHASE.DELIVERED,
      pickedUpAt: at(600),
      deliveredAt: at(600),
    });
  });

  it('kayitli teslim hesaptan once bile olsa kayitli anlar gosterilir; hesap almasi karismaz', () => {
    expect(view({ pickedUpAt: at(70), deliveredAt: at(130) }, PROGRESS.TO_MARKET)).toMatchObject({
      phase: TRACKING_PHASE.DELIVERED,
      pickedUpAt: at(70),
      deliveredAt: at(130),
    });
    // Yalniz teslim kayitli (savunma): alma = teslim; hesaplanan alma (60) kullanilmaz.
    for (const progress of Object.values(PROGRESS)) {
      expect(view({ deliveredAt: at(130) }, progress)).toMatchObject({
        phase: TRACKING_PHASE.DELIVERED,
        pickedUpAt: at(130),
        deliveredAt: at(130),
      });
    }
  });

  it('kayit yoksa hesaplanan anlar AYNEN (normal yol degismedi)', () => {
    expect(view({}, PROGRESS.DELIVERED)).toMatchObject({
      phase: TRACKING_PHASE.DELIVERED,
      pickedUpAt: at(60),
      deliveredAt: at(120),
    });
  });
});
