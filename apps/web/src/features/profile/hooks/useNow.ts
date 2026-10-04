import { useEffect, useState } from 'react';

/** Geri sayimin adimi: saniye. */
const TICK_MS = 1000;

/**
 * Su anki zaman (ms), acikken saniyede bir guncellenir (T11.14: kodun
 * gecerliligi ve yeni kod beklemesi). Kapaliyken sayac kurulmaz; kurulan
 * sayac bilesen kalkinca ya da kapaninca durdurulur.
 */
export function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) {
      return undefined;
    }
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), TICK_MS);
    return () => window.clearInterval(timer);
  }, [active]);
  return now;
}
