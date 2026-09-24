/**
 * Alti cekirdek kural: her esigin bir alti, tam kendisi ve bir ustu; eksik
 * baglamda tetiklenmeme; gerekcede kisisel veri olmamasi.
 */

import { fixedClock } from '@getir/core';
import { describe, expect, it } from 'vitest';

import {
  BASKET_ANOMALY_MULTIPLIER,
  GEOFENCE_MAX_DISTANCE_KM,
  MAX_ACCOUNTS_PER_DEVICE,
  MIN_CHECKOUT_DWELL_MS,
  NEW_ACCOUNT_MAX_AGE_MS,
} from '../../src/config/constants.js';
import type { GeoPoint, RiskContext } from '../../src/domain/risk-context.js';
import { createAccountAgeRule } from '../../src/rules/account-age.rule.js';
import { basketAnomalyRule } from '../../src/rules/basket-anomaly.rule.js';
import { checkoutDwellRule } from '../../src/rules/checkout-dwell.rule.js';
import { geofenceRule } from '../../src/rules/geofence.rule.js';
import { ipDeviceRule } from '../../src/rules/ip-device.rule.js';
import { orderHistoryRule } from '../../src/rules/order-history.rule.js';

const NOW = Date.UTC(2026, 8, 24, 12, 0, 0);
const base: RiskContext = { userId: 'usr_1' };
const at = (fields: Partial<RiskContext>): RiskContext => ({ ...base, ...fields });

describe('account-age', () => {
  const rule = createAccountAgeRule(fixedClock(NOW));
  const createdAgo = (ms: number) => at({ accountCreatedAt: new Date(NOW - ms) });

  it('24 saatten 1 ms genc hesap tetikler; tam 24 saat tetiklemez', async () => {
    expect((await rule.evaluate(createdAgo(NEW_ACCOUNT_MAX_AGE_MS - 1))).hit).toBe(true);
    expect((await rule.evaluate(createdAgo(NEW_ACCOUNT_MAX_AGE_MS))).hit).toBe(false);
  });

  it('gerekce saat cinsinden yasi soyler', async () => {
    expect((await rule.evaluate(createdAgo(4 * 60 * 60 * 1000))).reason).toBe('hesap 4 saatlik');
  });

  it('acilis ani bilinmiyorsa tetiklemez', async () => {
    expect((await rule.evaluate(base)).hit).toBe(false);
  });
});

describe('order-history', () => {
  const check = async (delivered: number | undefined, cancelled?: number) =>
    orderHistoryRule.evaluate(
      at({
        ...(delivered === undefined ? {} : { deliveredOrderCount: delivered }),
        ...(cancelled === undefined ? {} : { cancelledOrderCount: cancelled }),
      }),
    );

  it('hic teslim edilmis siparis yoksa tetikler (yeni uye)', async () => {
    expect(await check(0, 0)).toEqual({ hit: true, reason: 'hic teslim edilmis siparis yok' });
  });

  it('iptal orani tam %50 tetiklemez, ustu tetikler', async () => {
    expect((await check(2, 2)).hit).toBe(false);
    expect((await check(2, 3)).hit).toBe(true);
    expect((await check(1, 3)).reason).toBe('iptal orani %75');
  });

  it('iptalsiz duzenli musteri tetiklemez', async () => {
    expect((await check(5)).hit).toBe(false);
  });

  it('teslimat sayisi bilinmiyorsa tetiklemez', async () => {
    expect((await check(undefined, 4)).hit).toBe(false);
  });
});

describe('basket-anomaly', () => {
  const AVERAGE = 10_000;
  // null = alan YOK. (undefined verilseydi varsayilan parametre devreye girip
  // ortalamayi sessizce AVERAGE yapardi.)
  const basket = (total: number, average: number | null = AVERAGE) =>
    basketAnomalyRule.evaluate(
      at({
        basketTotalMinor: total,
        ...(average === null ? {} : { userAverageBasketMinor: average }),
      }),
    );

  it('ortalamanin tam 3 kati tetiklemez, 1 kurus fazlasi tetikler', async () => {
    expect((await basket(AVERAGE * BASKET_ANOMALY_MULTIPLIER)).hit).toBe(false);
    expect((await basket(AVERAGE * BASKET_ANOMALY_MULTIPLIER + 1)).hit).toBe(true);
  });

  it('gerekce kat sayisini tek ondalikla verir', async () => {
    expect((await basket(75_000)).reason).toBe('sepet ortalamanin 7.5 kati');
  });

  it('ortalama yoksa ya da sifirsa (ilk siparis) tetiklemez', async () => {
    expect((await basket(1_000_000, null)).hit).toBe(false);
    expect((await basket(1_000_000, 0)).hit).toBe(false);
  });
});

describe('checkout-dwell', () => {
  const dwell = (ms?: number) =>
    checkoutDwellRule.evaluate(at(ms === undefined ? {} : { checkoutDwellMs: ms }));

  it('3 sn den 1 ms kisa tetikler; tam 3 sn tetiklemez', async () => {
    expect((await dwell(MIN_CHECKOUT_DWELL_MS - 1)).hit).toBe(true);
    expect((await dwell(MIN_CHECKOUT_DWELL_MS)).hit).toBe(false);
  });

  it('sure olculmediyse (ilk degerlendirme) tetiklemez', async () => {
    expect((await dwell()).hit).toBe(false);
  });
});

describe('geofence', () => {
  const KADIKOY: GeoPoint = { lat: 40.9885, lng: 29.0262 };
  /** Ayni boylamda, kuzeye tam `km` uzaklikta nokta (1 derece enlem ~ 111.195 km). */
  const north = (km: number): GeoPoint => ({ lat: KADIKOY.lat + km / 111.195, lng: KADIKOY.lng });
  // null = konum YOK (varsayilan parametreye undefined verilemez, bkz. basket).
  const fence = (session: GeoPoint | null, delivery: GeoPoint | null = KADIKOY) =>
    geofenceRule.evaluate(
      at({
        ...(delivery === null ? {} : { deliveryLocation: delivery }),
        ...(session === null ? {} : { sessionLocation: session }),
      }),
    );

  it('49.9 km tetiklemez, 50.1 km tetikler (esik ham mesafeyle, yuvarlanmadan)', async () => {
    expect((await fence(north(GEOFENCE_MAX_DISTANCE_KM - 0.1))).hit).toBe(false);
    expect((await fence(north(GEOFENCE_MAX_DISTANCE_KM + 0.1))).hit).toBe(true);
  });

  it('Istanbul ici ilce farki tetiklemez; Ankara tetikler', async () => {
    expect((await fence({ lat: 41.0431, lng: 29.0071 })).hit).toBe(false);
    const ankara = await fence({ lat: 39.9334, lng: 32.8597 });
    expect(ankara.hit).toBe(true);
    expect(ankara.reason).toMatch(/^oturum teslimat adresinden 3\d\d km uzakta$/);
  });

  it('konumlardan biri yoksa tetiklemez', async () => {
    expect((await fence(null)).hit).toBe(false);
    expect((await fence({ lat: 39.93, lng: 32.86 }, null)).hit).toBe(false);
  });

  it('gerekce koordinat icermez (kisisel veri)', async () => {
    expect((await fence({ lat: 39.9334, lng: 32.8597 })).reason).not.toMatch(/39\.9|32\.8/);
  });
});

describe('ip-device', () => {
  const device = (fields: Partial<RiskContext>) => ipDeviceRule.evaluate(at(fields));

  it('cihazda 3 hesap VETO ister; 2 hesap temiz', async () => {
    expect(await device({ accountsOnDevice: MAX_ACCOUNTS_PER_DEVICE })).toEqual({
      hit: true,
      reason: 'cihazda 3 hesap',
      veto: true,
    });
    expect((await device({ accountsOnDevice: MAX_ACCOUNTS_PER_DEVICE - 1 })).hit).toBe(false);
  });

  it('IP degisimi yalnizca puan verir, veto istemez', async () => {
    expect(await device({ ipAddress: '10.0.0.2', previousIpAddress: '10.0.0.1' })).toEqual({
      hit: true,
      reason: 'IP onceki oturumdan farkli',
      veto: false,
    });
  });

  it('iki sinyal birlikte: tek sonuc, gerekcede ikisi de, veto var', async () => {
    const outcome = await device({ accountsOnDevice: 4, ipAddress: 'a', previousIpAddress: 'b' });
    expect(outcome).toEqual({
      hit: true,
      reason: 'cihazda 4 hesap, IP onceki oturumdan farkli',
      veto: true,
    });
  });

  it('onceki IP yoksa (ilk oturum) ya da ayniysa tetiklemez', async () => {
    expect((await device({ ipAddress: '10.0.0.1' })).hit).toBe(false);
    expect((await device({ ipAddress: '10.0.0.1', previousIpAddress: '10.0.0.1' })).hit).toBe(
      false,
    );
  });

  it('gerekce IP adresini ve cihaz kimligini icermez (kisisel veri)', async () => {
    const outcome = await device({
      accountsOnDevice: 5,
      deviceId: 'dev_gizli',
      ipAddress: '85.105.1.2',
      previousIpAddress: '78.1.2.3',
    });
    expect(outcome.reason).not.toMatch(/85\.105|78\.1|dev_gizli/);
  });
});
