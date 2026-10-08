import { useEffect, useState } from 'react';

import { createLoaderGate } from './loader-gate';

/**
 * Bekleyis surerken gosterge gorunsun mu (F18): kural createLoaderGate'te
 * (300 ms esik, en az 600 ms). Bekleyis bitse de gosterge en az sure dolana
 * kadar kalabilir; cagiran gostergeyi icerigin USTUNE cizer.
 */
export function useLoaderVisible(busy: boolean): boolean {
  const [visible, setVisible] = useState(false);
  const [gate] = useState(() => createLoaderGate(setVisible));
  useEffect(() => {
    gate.busy(busy);
  }, [gate, busy]);
  useEffect(() => () => gate.dispose(), [gate]);
  return visible;
}
