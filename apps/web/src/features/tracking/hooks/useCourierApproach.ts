import { isCourierApproaching } from '@getir/contracts';
import type { OrderTracking } from '@getir/contracts';
import { useEffect, useRef, useState } from 'react';

import { APPROACH_NOTICE_MS } from '../constants';
import {
  approachDecision,
  approachNotified,
  markApproachNotified,
} from '../services/approach-once';
import { noticePaused } from '../services/notice-rules';

/**
 * Yaklasma bildirimi (F22): paket alinmis ve kalan yol esikte ya da altinda
 * (sozlesme isCourierApproaching, 300 m) olunca siparis basina BIR KEZ.
 * Harita zaten aciksa gosterilmez, yalniz isaretlenir; harita acilinca
 * gorunen bildirim kapanir. Gorunen bildirim 15 sn sonra kendiliginden
 * kapanir; uzerinde fare YA DA odak varken sure durur (WCAG 2.2.1), ikisi de
 * cikinca bastan baslar.
 */
export function useCourierApproach(
  orderId: string,
  tracking: OrderTracking | undefined,
  dialogOpen: boolean,
  /** Bildirimin metinleri hazir mi (icerik); degilse karar beklenir. */
  canShow: boolean,
  /** Bildirim bir kez gosterildi ya da isaretlendi: kapali pencerede izleme durur (N4). */
  onNotified: () => void,
) {
  const [visible, setVisible] = useState(false);
  // Fare ve odak AYRI (PM N1): birinden cikmak, digeri surerken sayaci baslatmaz.
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const notifiedRef = useRef(onNotified);
  notifiedRef.current = onNotified;
  const approaching = tracking !== undefined && isCourierApproaching(tracking);

  useEffect(() => {
    const decision = approachDecision(approaching, approachNotified(orderId), dialogOpen, canShow);
    if (decision === 'none') {
      return;
    }
    markApproachNotified(orderId);
    notifiedRef.current();
    if (decision === 'show') {
      // Dis olaya (yoklama cevabi) tepki: bildirim bir kez acilir.
      setVisible(true);
    }
  }, [approaching, orderId, dialogOpen, canShow]);

  // Pencere acilinca gorunur bildirim kapanir (PM N3).
  useEffect(() => {
    if (dialogOpen) {
      setVisible(false);
    }
  }, [dialogOpen]);

  const paused = noticePaused(hovered, focused);
  useEffect(() => {
    if (!visible || paused) {
      return undefined;
    }
    const timer = window.setTimeout(() => setVisible(false), APPROACH_NOTICE_MS);
    return () => window.clearTimeout(timer);
  }, [visible, paused]);

  return {
    visible,
    /** Odak bildirimin icinde mi (kapaninca odak yalniz o zaman tasinir; PM B1). */
    focused,
    dismiss: () => {
      setVisible(false);
      setHovered(false);
      setFocused(false);
    },
    setHovered,
    setFocused,
  };
}
