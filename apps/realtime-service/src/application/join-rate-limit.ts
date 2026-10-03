/**
 * room.join siniri (D8): soket basina kayan pencere, bellekte.
 *
 * Neden soket basina ve bellekte: amac tek bir baglantinin jeton denemesi ya da
 * hatali bir istemci dongusuyle sunucuyu mesgul etmesini kesmek. Durum soketle
 * birlikte olur; yeniden baglanan istemcinin sayaci sifirlanir (socket-events.md).
 * Kopyalar arasi (Redis) sayac gerekmez: soket tek kopyaya baglidir.
 */

import type { Clock } from '@getir/core';

export interface JoinRateLimitOptions {
  readonly maxAttempts: number;
  readonly windowMs: number;
  readonly clock: Clock;
}

/** Bir soketin sayaci. tryAcquire false donerse deneme reddedilir ve SAYILMAZ. */
export interface JoinRateLimiter {
  tryAcquire(): boolean;
}

export function createJoinRateLimiter(options: JoinRateLimitOptions): JoinRateLimiter {
  // Pencere icindeki kabul edilmis denemelerin zamani; en fazla maxAttempts eleman.
  const attempts: number[] = [];
  return {
    tryAcquire: () => {
      const now = options.clock.now();
      while (attempts.length > 0 && now - (attempts[0] ?? now) >= options.windowMs) {
        attempts.shift();
      }
      if (attempts.length >= options.maxAttempts) {
        return false;
      }
      attempts.push(now);
      return true;
    },
  };
}
