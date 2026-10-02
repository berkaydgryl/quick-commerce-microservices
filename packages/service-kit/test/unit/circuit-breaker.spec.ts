/**
 * Devre kesici (D17): durum makinesi, sahte saatle. Metrikler kayit defterinden okunur.
 */

import { metricsRegistry } from '@getir/observability';
import { metricValue } from '@getir/observability/testing';
import { recordingLogger } from '@getir/core/testing';
import type { LogLine } from '@getir/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { BREAKER_STATE, CircuitBreaker } from '../../src/grpc/circuit-breaker.js';
import { CLIENT_METRICS } from '../../src/grpc/client-metrics.js';

const OPEN_MS = 10_000;
let now: number;
let lines: LogLine[];

function breaker(threshold = 3): CircuitBreaker {
  return new CircuitBreaker({
    target: 'payment',
    failureThreshold: threshold,
    openMs: OPEN_MS,
    logger: recordingLogger(lines),
    now: () => now,
  });
}

function failTimes(target: CircuitBreaker, count: number): void {
  for (let i = 0; i < count; i += 1) {
    expect(target.tryAcquire()).toBe(true);
    target.recordFailure();
  }
}

beforeEach(() => {
  now = 1_000_000;
  lines = [];
  metricsRegistry.resetMetrics();
});

describe('CircuitBreaker', () => {
  it('esige kadar kapali kalir; ust uste esik kadar hatada acilir ve cagri reddedilir', async () => {
    const target = breaker(3);

    failTimes(target, 2);
    expect(target.currentState).toBe(BREAKER_STATE.CLOSED);
    failTimes(target, 1);

    expect(target.currentState).toBe(BREAKER_STATE.OPEN);
    expect(target.tryAcquire()).toBe(false);
    expect(await metricValue(CLIENT_METRICS.BREAKER_STATE, { target: 'payment' })).toBe(2);
    expect(await metricValue(CLIENT_METRICS.BREAKER_REJECTED, { target: 'payment' })).toBe(1);
    expect(lines.filter((line) => line.level === 'warn').map((line) => line.fields)).toEqual([
      { target: 'payment', consecutiveFailures: 3, openMs: OPEN_MS },
    ]);
  });

  it('araya giren cevap (is hatasi dahil) sayaci sifirlar: ust uste olmayan hata acmaz', () => {
    const target = breaker(3);

    failTimes(target, 2);
    target.tryAcquire();
    target.recordSuccess();
    failTimes(target, 2);

    expect(target.currentState).toBe(BREAKER_STATE.CLOSED);
  });

  it('sure dolunca yari acik: TEK deneme cagrisi gecer, digerleri reddedilir', () => {
    const target = breaker(1);
    failTimes(target, 1);

    now += OPEN_MS - 1;
    expect(target.tryAcquire()).toBe(false);
    now += 1;
    expect(target.tryAcquire()).toBe(true);
    expect(target.currentState).toBe(BREAKER_STATE.HALF_OPEN);
    expect(target.tryAcquire()).toBe(false);
  });

  it('deneme cagrisi cevap alirsa devre kapanir (INFO), sonraki cagrilar gecer', async () => {
    const target = breaker(1);
    failTimes(target, 1);
    now += OPEN_MS;
    target.tryAcquire();

    target.recordSuccess();

    expect(target.currentState).toBe(BREAKER_STATE.CLOSED);
    expect(target.tryAcquire()).toBe(true);
    expect(target.tryAcquire()).toBe(true);
    expect(await metricValue(CLIENT_METRICS.BREAKER_STATE, { target: 'payment' })).toBe(0);
    expect(lines.at(-1)).toMatchObject({ level: 'info', fields: { target: 'payment' } });
  });

  it('deneme cagrisi da duserse devre yeniden acilir ve sure bastan sayilir', () => {
    const target = breaker(5);
    failTimes(target, 5);
    now += OPEN_MS;
    target.tryAcquire();

    target.recordFailure();

    expect(target.currentState).toBe(BREAKER_STATE.OPEN);
    now += OPEN_MS - 1;
    expect(target.tryAcquire()).toBe(false);
  });
});
