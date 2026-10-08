import { useEffect, useState } from 'react';

import { retryWaitSeconds } from '../../cards/services/card-form';
import { useNow } from '../../profile/hooks/useNow';
import { remainingSeconds } from '../services/countdown';
import { monotonicNow } from '../services/monotonic-clock';

const MS_PER_SECOND = 1000;

/**
 * Cok fazla hatali kod (429 RATE_LIMITED + Retry-After; F15b, #163): tekrar
 * denenebilecek ana kadar geri sayim. Odeme sayfasinin tek monotonik saati
 * (3DS ve rezervasyonla ayni); kalan sure her cizimde saatten hesaplanir,
 * useNow yalniz saniyede bir yeniden cizer (ilk karede eski sayi gorunmez).
 * start(hata) 429 ise geri sayimi baslatir ve true doner; bekleme bitince kalkar.
 */
export function useRetryWait() {
  const [retryAt, setRetryAt] = useState<number | null>(null);
  useNow(retryAt !== null);
  const waitSeconds = retryAt === null ? 0 : remainingSeconds(retryAt, monotonicNow());
  useEffect(() => {
    if (retryAt !== null && waitSeconds === 0) setRetryAt(null);
  }, [retryAt, waitSeconds]);
  return {
    waitSeconds,
    start: (error: unknown): boolean => {
      const wait = retryWaitSeconds(error);
      if (wait === null) return false;
      setRetryAt(monotonicNow() + wait * MS_PER_SECOND);
      return true;
    },
  };
}
