/**
 * Bagimli servise devre kesici (D17).
 *
 * Bagimli servis dustugunde her istek sure siniri dolana kadar beklemesin:
 *   kapali    -> cagrilar gider; ust uste `failureThreshold` "ulasilamaz" hata
 *                devreyi ACAR;
 *   acik      -> `openMs` boyunca cagri ag'a hic gitmez, hemen reddedilir;
 *   yari acik -> sure dolunca TEK deneme cagrisina izin verilir: cevap gelirse
 *                devre kapanir, gelmezse yeniden acilir.
 *
 * Neyin hata sayilacagina CAGIRAN karar verir (unary-call.ts): yalnizca
 * "ulasilamaz" sinifi (baglanti yok, sure doldu, SERVICE_UNAVAILABLE). Is
 * hatalari (kart reddi, stok yetmedi, dogrulama) servisin CALISTIGINI gosterir;
 * devreyi acmaz, aksine sayaci sifirlar.
 *
 * Sure DUVAR SAATIDIR (tasima kaygisi): testte `now` verilir.
 */

import type { Logger } from '@getir/core';

import { recordBreakerRejection, recordBreakerState } from './client-metrics.js';

export const BREAKER_STATE = {
  CLOSED: 'closed',
  HALF_OPEN: 'half-open',
  OPEN: 'open',
} as const;

export type BreakerState = (typeof BREAKER_STATE)[keyof typeof BREAKER_STATE];

export interface CircuitBreakerOptions {
  /** Bagimli servisin adi (orn. payment): metrik etiketi ve gunluk alani. */
  readonly target: string;
  /** Ust uste bu kadar "ulasilamaz" hatada devre acilir. */
  readonly failureThreshold: number;
  /** Devrenin acik kaldigi sure (ms); sonra tek deneme cagrisina izin verilir. */
  readonly openMs: number;
  /** Gecisler: acilinca WARN, kapaninca INFO. */
  readonly logger?: Logger;
  /** Varsayilan Date.now; testte sahte saat. */
  readonly now?: () => number;
}

export class CircuitBreaker {
  private state: BreakerState = BREAKER_STATE.CLOSED;
  private consecutiveFailures = 0;
  private openUntil = 0;
  private trialInFlight = false;
  private readonly now: () => number;

  constructor(private readonly options: CircuitBreakerOptions) {
    this.now = options.now ?? Date.now;
    recordBreakerState(options.target, BREAKER_STATE.CLOSED);
  }

  get target(): string {
    return this.options.target;
  }

  get currentState(): BreakerState {
    return this.state;
  }

  /**
   * Cagri yapilabilir mi? Hayirsa cagri ag'a gitmemeli; reddedilen sayilir.
   * Yari acik devre ayni anda yalnizca TEK deneme cagrisina izin verir.
   */
  tryAcquire(): boolean {
    if (this.state === BREAKER_STATE.OPEN) {
      if (this.now() < this.openUntil) {
        recordBreakerRejection(this.options.target);
        return false;
      }
      this.moveTo(BREAKER_STATE.HALF_OPEN);
    }
    if (this.state === BREAKER_STATE.HALF_OPEN) {
      if (this.trialInFlight) {
        recordBreakerRejection(this.options.target);
        return false;
      }
      this.trialInFlight = true;
    }
    return true;
  }

  /** Bagimli servis cevap verdi (is hatasi dahil): sayac sifirlanir, devre kapanir. */
  recordSuccess(): void {
    this.consecutiveFailures = 0;
    this.trialInFlight = false;
    if (this.state !== BREAKER_STATE.CLOSED) {
      this.moveTo(BREAKER_STATE.CLOSED);
      this.options.logger?.info(
        { target: this.options.target },
        'devre kapandi: bagimli servis yeniden cevap veriyor',
      );
    }
  }

  /** Bagimli servis ulasilamadi: esik dolarsa (ya da deneme cagrisi dustuyse) devre acilir. */
  recordFailure(): void {
    this.trialInFlight = false;
    this.consecutiveFailures += 1;
    const tripped =
      this.state === BREAKER_STATE.HALF_OPEN ||
      (this.state === BREAKER_STATE.CLOSED &&
        this.consecutiveFailures >= this.options.failureThreshold);
    if (!tripped) {
      return;
    }
    this.openUntil = this.now() + this.options.openMs;
    this.moveTo(BREAKER_STATE.OPEN);
    this.options.logger?.warn(
      {
        target: this.options.target,
        consecutiveFailures: this.consecutiveFailures,
        openMs: this.options.openMs,
      },
      'devre acildi: bagimli servis ulasilamiyor, cagrilar bekletilmeden reddedilecek',
    );
  }

  private moveTo(next: BreakerState): void {
    this.state = next;
    recordBreakerState(this.options.target, next);
  }
}
