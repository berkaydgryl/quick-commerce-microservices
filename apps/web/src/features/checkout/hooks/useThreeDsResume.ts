import { useEffect, useRef, useState } from 'react';

import { fetchOrder } from '../../orders/api/orders.api';
import { clearPendingThreeDs, readPendingThreeDs } from '../services/pending-three-ds';
import type { OrderFlowDeps } from '../services/place-order';
import { RESUME_RETRY_DELAY_MS, resumeDecision, resumeNextStep } from '../services/resume-three-ds';
import type { ResumeDecision } from '../services/resume-three-ds';

export interface ThreeDsResume {
  /** Karar bekleniyor: akis bu surede yeni rezervasyon ALMAZ (ayni sepet iki kez kilitlenmesin). */
  readonly resuming: boolean;
  /** Odeme durumu okunamadi (denemeler bitti): siparis birakilmaz, kayit kalir. */
  readonly failed: boolean;
  /** "Tekrar dene": denemeleri bastan baslatir. */
  readonly retry: () => void;
}

/**
 * Yenilemede bekleyen 3DS (F15b, #163): sayfa acilisinda sekmede bekleyen
 * siparis kimligi varsa siparis sunucudan okunur ve karar akisa verilir (ayni
 * challenge, sunucunun kalan hakki ve suresi; odendiyse basari; kapali
 * dogrulamada birakma). Durum okunamazsa 3 kez 2 sn arayla yeniden denenir,
 * sonra uyari ve "Tekrar dene"; bu surece siparis birakilmaz, yeni rezervasyon
 * alinmaz (gecici kesinti siparisi yanlislikla iptal etmesin).
 */
export function useThreeDsResume(
  deps: OrderFlowDeps,
  onDecision: (decision: Exclude<ResumeDecision, { kind: 'gone' | 'unknown' }>) => void,
): ThreeDsResume {
  const [pendingId] = useState(readPendingThreeDs);
  const [status, setStatus] = useState<'idle' | 'resuming' | 'failed'>(
    pendingId === undefined ? 'idle' : 'resuming',
  );
  const [round, setRound] = useState(0);
  const handler = useRef(onDecision);
  handler.current = onDecision;

  useEffect(() => {
    if (pendingId === undefined || status !== 'resuming') {
      return undefined;
    }
    const controller = new AbortController();
    let retries = 0;
    let timer: number | undefined;
    const attempt = () => {
      // GET /v1/orders/{id}: yalniz sahibine; baskasinin ya da olmayan siparis 404.
      fetchOrder(deps.client, pendingId, controller.signal).then(
        (order) => decide({ order }),
        (error: unknown) => decide({ error }),
      );
    };
    const decide = (result: Parameters<typeof resumeDecision>[1]) => {
      if (controller.signal.aborted) return;
      const decision = resumeDecision(pendingId, result, deps.now());
      const step = resumeNextStep(decision, retries);
      if (step === 'retry') {
        retries += 1;
        timer = window.setTimeout(attempt, RESUME_RETRY_DELAY_MS);
        return;
      }
      if (step === 'fail' || decision.kind === 'unknown') {
        setStatus('failed');
        return;
      }
      setStatus('idle');
      if (decision.kind === 'gone') {
        clearPendingThreeDs();
        return;
      }
      handler.current(decision);
    };
    attempt();
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [pendingId, deps, status, round]);

  return {
    resuming: status === 'resuming',
    failed: status === 'failed',
    retry: () => {
      setStatus('resuming');
      setRound((value) => value + 1);
    },
  };
}

/**
 * Dogrulama acikken odeme sayfasindan uygulama icinde ayrilinca (Geri) kayit
 * silinir (F15b): sonraki ziyaret eski siparisi baska bir sepetle surdurup
 * yeni sepeti bosaltmasin. Yenilemede bilesen kalkmaz; kayit kalir ve surer.
 */
export function useForgetPendingOnLeave(challenging: boolean): void {
  const live = useRef(challenging);
  live.current = challenging;
  useEffect(
    () => () => {
      if (live.current) clearPendingThreeDs();
    },
    [],
  );
}
