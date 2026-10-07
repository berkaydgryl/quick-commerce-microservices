import { isCourierApproaching } from '@getir/contracts';
import type { OrderTracking } from '@getir/contracts';
import { useEffect, useState } from 'react';

import { APPROACH_NOTICE_MS } from '../constants';
import {
  approachDecision,
  approachNotified,
  markApproachNotified,
} from '../services/approach-once';

/**
 * Yaklasma bildirimi (F22): paket alinmis ve kalan yol esikte ya da altinda
 * (sozlesme isCourierApproaching, 300 m) olunca siparis basina BIR KEZ.
 * Harita zaten aciksa gosterilmez, yalniz isaretlenir. Gorunen bildirim 15
 * sn sonra kendiliginden kapanir; uzerinde fare ya da odak varken sure durur
 * (WCAG 2.2.1), birakilinca bastan baslar.
 */
export function useCourierApproach(
  orderId: string,
  tracking: OrderTracking | undefined,
  dialogOpen: boolean,
) {
  const [visible, setVisible] = useState(false);
  const [paused, setPaused] = useState(false);
  const approaching = tracking !== undefined && isCourierApproaching(tracking);

  useEffect(() => {
    const decision = approachDecision(approaching, approachNotified(orderId), dialogOpen);
    if (decision === 'none') {
      return;
    }
    markApproachNotified(orderId);
    if (decision === 'show') {
      // Dis olaya (yoklama cevabi) tepki: bildirim bir kez acilir.
      setVisible(true);
    }
  }, [approaching, orderId, dialogOpen]);

  useEffect(() => {
    if (!visible || paused) {
      return undefined;
    }
    const timer = window.setTimeout(() => setVisible(false), APPROACH_NOTICE_MS);
    return () => window.clearTimeout(timer);
  }, [visible, paused]);

  return {
    visible,
    dismiss: () => {
      setVisible(false);
      setPaused(false);
    },
    pause: () => setPaused(true),
    resume: () => setPaused(false),
  };
}
