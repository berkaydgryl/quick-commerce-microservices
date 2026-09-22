/**
 * Durum defteri gRPC OLMADAN test edilir - ayrilmanin asil kazanci bu:
 * sunucu ayaga kaldirmadan, soket acmadan, milisaniyeler icinde.
 */

import { describe, expect, it, vi } from 'vitest';

import { OVERALL_HEALTH_KEY, SERVING_STATUS } from '../../src/config/constants.js';
import { HealthRegistry } from '../../src/health/registry.js';

const SERVICE = 'getir.catalog.v1.CatalogService';

describe('HealthRegistry', () => {
  it('sunucu ilk anda NOT_SERVING baslar', () => {
    // Port acilmadan "ayakta" demek, gateway'in bos sunucuya istek gondermesi demek.
    expect(new HealthRegistry().getStatus(OVERALL_HEALTH_KEY)).toBe(SERVING_STATUS.NOT_SERVING);
  });

  it('bildirilmemis servis icin undefined doner', () => {
    expect(new HealthRegistry().getStatus(SERVICE)).toBeUndefined();
  });

  it('durum degisimini dinleyenlere haber verir', () => {
    const registry = new HealthRegistry();
    const listener = vi.fn();
    registry.subscribe(SERVICE, listener);

    registry.setStatus(SERVICE, SERVING_STATUS.SERVING);

    expect(listener).toHaveBeenCalledWith(SERVING_STATUS.SERVING);
    expect(registry.getStatus(SERVICE)).toBe(SERVING_STATUS.SERVING);
  });

  it('ayni durum tekrar yazilirsa dinleyici rahatsiz edilmez', () => {
    const registry = new HealthRegistry();
    registry.setStatus(SERVICE, SERVING_STATUS.SERVING);
    const listener = vi.fn();
    registry.subscribe(SERVICE, listener);

    registry.setStatus(SERVICE, SERVING_STATUS.SERVING);

    expect(listener).not.toHaveBeenCalled();
  });

  it('abonelik iptal edilince haber gitmez', () => {
    const registry = new HealthRegistry();
    const listener = vi.fn();
    const unsubscribe = registry.subscribe(SERVICE, listener);

    unsubscribe();
    registry.setStatus(SERVICE, SERVING_STATUS.SERVING);

    expect(listener).not.toHaveBeenCalled();
  });

  it('dinleyiciler servis bazindadir', () => {
    const registry = new HealthRegistry();
    const listener = vi.fn();
    registry.subscribe(SERVICE, listener);

    registry.setStatus(OVERALL_HEALTH_KEY, SERVING_STATUS.SERVING);

    expect(listener).not.toHaveBeenCalled();
  });
});
