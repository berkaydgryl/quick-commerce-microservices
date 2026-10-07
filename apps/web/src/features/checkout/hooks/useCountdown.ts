import { useEffect, useState } from 'react';

import { remainingSeconds } from '../services/countdown';

/** Tarayicinin monotonik saati (duvar saati kaysa da geri sayim kaymaz). */
const monotonicNow = () => performance.now();

/** Saniyede bir yeterli; yarim saniye, gorunen sayinin gec donmesini onler. */
const TICK_MS = 500;

/**
 * Son ana kalan saniye (T12.4); son an yoksa (sunucu sure bildirmedi) undefined
 * ve zamanlayici kurulmaz. Hesap saf fonksiyonda (countdown.ts), bu hook
 * yalnizca saati okur ve yeniden cizer. Saat disaridan verilebilir (test).
 * Zamanlayici her son an degisiminde ve cikista temizlenir.
 */
export function useCountdown(
  deadline: number | undefined,
  now: () => number = monotonicNow,
): number | undefined {
  const [seconds, setSeconds] = useState(() =>
    deadline === undefined ? undefined : remainingSeconds(deadline, now()),
  );
  useEffect(() => {
    if (deadline === undefined) {
      setSeconds(undefined);
      return undefined;
    }
    const tick = () => setSeconds(remainingSeconds(deadline, now()));
    tick();
    const timer = setInterval(tick, TICK_MS);
    return () => clearInterval(timer);
  }, [deadline, now]);
  return seconds;
}
