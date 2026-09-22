/**
 * Saglik durumu kayit defteri - DURUM, tasima degil.
 *
 * Tek sorumluluk: "hangi servis su an ayakta?" sorusunu tutmak ve degisimi
 * dinleyenlere haber vermek. Burada gRPC, akis (stream) ya da protokol
 * kavrami YOKTUR; bu yuzden gRPC olmadan da test edilir ve ileride ayni defter
 * HTTP /healthz ucuna da baglanabilir.
 *
 * gRPC yuzeyi ayri dosyadadir: src/grpc/health.ts
 */

import { OVERALL_HEALTH_KEY, SERVING_STATUS } from '../config/constants.js';
import type { ServingStatus } from '../config/constants.js';
import type { Logger } from '../logger.js';

/** Durum degisiminde cagrilir. */
export type HealthListener = (status: ServingStatus) => void;

/** Dinlemeyi birakir. */
export type Unsubscribe = () => void;

export class HealthRegistry {
  private readonly statuses = new Map<string, ServingStatus>();
  private readonly listeners = new Map<string, Set<HealthListener>>();
  private readonly logger: Logger | undefined;

  constructor(logger?: Logger) {
    this.logger = logger;
    // Sunucu daha dinlemeye baslamadan "ayakta" demek YANLIS olurdu; ilk durum
    // NOT_SERVING'dir, bind basarili olunca SERVING'e cevrilir.
    this.statuses.set(OVERALL_HEALTH_KEY, SERVING_STATUS.NOT_SERVING);
  }

  /** Servisin (veya bos anahtarla butun sunucunun) durumunu gunceller. */
  setStatus(service: string, status: ServingStatus): void {
    if (this.statuses.get(service) === status) {
      return;
    }
    this.statuses.set(service, status);
    // Alan adi "service" DEGIL: sunucunun gunlukcusu zaten { service: 'catalog' }
    // baglamiyla geliyor ve ayni JSON'da iki "service" anahtari olusuyordu.
    this.logger?.info({ target: service || '(sunucu)', status }, 'health durumu degisti');

    for (const listener of this.listeners.get(service) ?? []) {
      listener(status);
    }
  }

  /** Kayitli durum; servis hic bildirilmediyse undefined. */
  getStatus(service: string): ServingStatus | undefined {
    return this.statuses.get(service);
  }

  /** Durum degisimini dinler; donen fonksiyon dinlemeyi birakir. */
  subscribe(service: string, listener: HealthListener): Unsubscribe {
    const listeners = this.listeners.get(service) ?? new Set<HealthListener>();
    listeners.add(listener);
    this.listeners.set(service, listeners);

    return () => {
      listeners.delete(listener);
    };
  }
}
