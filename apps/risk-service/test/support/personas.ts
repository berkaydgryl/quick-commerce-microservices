/**
 * Test personalari (roadmap "Test personalari"). Her band icin bir hesap:
 * ayni tablo T6.2'de sahte baglamla, T8.1'de gercek seed hesaplariyla ve
 * T15.1'de demo betiginde kullanilir. Degerler SUNUCU tarafi sinyallerdir;
 * istemciden gelmez (B9).
 */

import { RISK_BANDS } from '@getir/core';
import type { RiskBand } from '@getir/core';

import type { GeoPoint, RiskContext } from '../../src/domain/risk-context.js';

export const PERSONA_NOW = Date.UTC(2026, 8, 24, 12, 0, 0);

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const ago = (ms: number): Date => new Date(PERSONA_NOW - ms);

/** Hazir adres "Ev" (Kadikoy) ve baska sehirler. */
const KADIKOY: GeoPoint = { lat: 40.9885, lng: 29.0262 };
const ANKARA: GeoPoint = { lat: 39.9334, lng: 32.8597 };
const IZMIR: GeoPoint = { lat: 38.4237, lng: 27.1428 };

export interface Persona {
  readonly name: string;
  readonly context: RiskContext;
  readonly expected: {
    readonly score: number;
    readonly band: RiskBand;
    readonly vetoedByRuleId?: string;
    /** Tetiklenmesi beklenen kurallar (kayit sirasinda). */
    readonly hits: readonly string[];
  };
}

/** Temiz, olagan bir oturum: diger personalar bundan sapar. */
const cleanSession = {
  deliveryLocation: KADIKOY,
  sessionLocation: KADIKOY,
  checkoutDwellMs: 45_000,
  accountsOnDevice: 1,
  ipAddress: '10.0.0.1',
} as const;

/** Onceki oturum ayni IP'den: "IP degisimi" tetiklenmez. Ilk oturumda bu alan HIC yoktur. */
const sameIpAsBefore = { previousIpAddress: '10.0.0.1' } as const;

export const PERSONAS: readonly Persona[] = [
  {
    name: 'Ayse (temiz, sadik musteri)',
    context: {
      userId: 'usr_ayse',
      accountCreatedAt: ago(30 * DAY_MS),
      deliveredOrderCount: 5,
      cancelledOrderCount: 0,
      basketTotalMinor: 25_000,
      userAverageBasketMinor: 20_000,
      ...cleanSession,
      ...sameIpAsBefore,
    },
    expected: { score: 0, band: RISK_BANDS.LOW, hits: [] },
  },
  {
    name: 'Zeynep (yeni uye)',
    context: {
      userId: 'usr_zeynep',
      accountCreatedAt: ago(1 * HOUR_MS),
      deliveredOrderCount: 0,
      cancelledOrderCount: 0,
      basketTotalMinor: 15_000,
      // Ilk oturum: onceki IP alani YOK (sameIpAsBefore eklenmez).
      ...cleanSession,
    },
    expected: { score: 35, band: RISK_BANDS.MEDIUM, hits: ['account-age', 'order-history'] },
  },
  {
    name: 'Can (supheli gezgin)',
    context: {
      userId: 'usr_can',
      accountCreatedAt: ago(10 * HOUR_MS),
      deliveredOrderCount: 1,
      cancelledOrderCount: 3,
      basketTotalMinor: 90_000,
      userAverageBasketMinor: 12_000,
      ...cleanSession,
      ...sameIpAsBefore,
      sessionLocation: ANKARA,
    },
    expected: {
      score: 70,
      band: RISK_BANDS.HIGH,
      hits: ['account-age', 'order-history', 'basket-anomaly', 'geofence'],
    },
  },
  {
    name: 'Ali (coklu hesap)',
    context: {
      userId: 'usr_ali',
      accountCreatedAt: ago(60 * DAY_MS),
      deliveredOrderCount: 3,
      cancelledOrderCount: 1,
      basketTotalMinor: 20_000,
      userAverageBasketMinor: 18_000,
      ...cleanSession,
      ...sameIpAsBefore,
      sessionLocation: IZMIR,
      checkoutDwellMs: 1_200,
      accountsOnDevice: 4,
    },
    expected: {
      score: 45,
      band: RISK_BANDS.CRITICAL,
      vetoedByRuleId: 'ip-device',
      hits: ['checkout-dwell', 'geofence', 'ip-device'],
    },
  },
  {
    name: 'Komsu (stok yarisi, ikinci tarayici)',
    context: {
      userId: 'usr_komsu',
      accountCreatedAt: ago(90 * DAY_MS),
      deliveredOrderCount: 12,
      cancelledOrderCount: 1,
      basketTotalMinor: 30_000,
      userAverageBasketMinor: 28_000,
      ...cleanSession,
      ...sameIpAsBefore,
    },
    expected: { score: 0, band: RISK_BANDS.LOW, hits: [] },
  },
];
