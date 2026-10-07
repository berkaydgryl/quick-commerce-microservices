import type { OrderStatus } from '@getir/contracts';
import { useEffect, useRef, useState } from 'react';

import { useAppHeaderContent } from '../../content/hooks/useAppHeaderContent';
import { useCourierTrackingContent } from '../../content/hooks/useCourierTrackingContent';
import { trackingMode } from '../api/queries';
import { useCourierApproach } from '../hooks/useCourierApproach';
import { useOrderTracking } from '../hooks/useOrderTracking';
import { approachNotified } from '../services/approach-once';
import { courierMapState } from '../services/map-state';
import { focusAfterClose, refetchOnModeChange } from '../services/notice-rules';

import { CourierApproachNotice } from './CourierApproachNotice';
import styles from './CourierApproachNotice.module.css';
import { CourierMapDialog } from './CourierMapDialog';

interface CourierTrackingProps {
  readonly userId: string;
  readonly orderId: string;
  readonly status: OrderStatus;
  readonly addressLine: string;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  /** Pencere kapaninca odak buraya doner ("Kuryem nerede"; acan oge yok olduysa). */
  readonly returnFocusId: string;
  /** "Kuryem nerede" yok olduysa (teslimde gizli) odak buraya: takip kartinin basligi. */
  readonly fallbackFocusId: string;
}

/**
 * Kurye takibinin baglantisi (F22; siparis detayi, F17 onay ekrani):
 * yoklama bicimi (kapali; kurye yoldayken 10 sn; pencere acikken 2 sn),
 * yaklasma bildirimi (bir kez, sag ustte) ve "Kuryem nerede" penceresi.
 * Bildirimin duyurusu kalici durum bolgesinden (role="status").
 */
export function CourierTracking({
  userId,
  orderId,
  status,
  addressLine,
  open,
  onOpenChange,
  returnFocusId,
  fallbackFocusId,
}: CourierTrackingProps) {
  const texts = useCourierTrackingContent();
  const map = useAppHeaderContent()?.addressSetup.map;
  // Bildirim bir kez gosterildiyse kapali pencerede izleme durur (N4).
  const [approachDone, setApproachDone] = useState(() => approachNotified(orderId));
  const mode = trackingMode(open, status, approachDone);
  const tracking = useOrderTracking(userId, orderId, mode);
  const approach = useCourierApproach(orderId, tracking.data, open, texts !== undefined, () =>
    setApproachDone(true),
  );
  const { refetch } = tracking;
  const settledError = useSettledError(tracking.error, tracking.isFetching);

  // Pencere acilinca ve acikken siparis son duruma gecince bir kez (B3); suren
  // istek iptal edilmez (cift istek yok).
  const previousMode = useRef(mode);
  useEffect(() => {
    const change = refetchOnModeChange(previousMode.current, mode);
    if (change !== 'none') {
      void refetch({ cancelRefetch: change === 'fresh' });
    }
    previousMode.current = mode;
  }, [mode, refetch]);

  // Kapaninca odak YALNIZ ogenin icindeyse tasinir (B1): pencere modal (odak
  // hep icinde); bildirimde yalniz kullanici ona odaklandiysa.
  const targets = { target: returnFocusId, fallback: fallbackFocusId };
  useReturnFocus(open, true, targets);
  useReturnFocus(approach.visible, approach.focused, targets);

  return (
    <>
      <div className={styles['c-approach-notice-region']} role="status">
        {texts !== undefined && approach.visible && (
          <CourierApproachNotice
            texts={texts}
            onShow={() => {
              approach.dismiss();
              onOpenChange(true);
            }}
            onClose={approach.dismiss}
            onHoverChange={approach.setHovered}
            onFocusChange={approach.setFocused}
          />
        )}
      </div>
      {open && texts !== undefined && map !== undefined && (
        <CourierMapDialog
          texts={texts}
          map={map}
          addressLine={addressLine}
          state={courierMapState({
            data: tracking.data,
            error: settledError,
            dataUpdatedAt: tracking.dataUpdatedAt,
            errorUpdatedAt: tracking.errorUpdatedAt,
            polling: mode === 'open',
          })}
          onRetry={() => void refetch()}
          onClose={() => onOpenChange(false)}
        />
      )}
    </>
  );
}

/**
 * shown true'dan false'a donunce odak, oge kapanmadan once icindeyse ve
 * sayfaya dustuyse hedefe (yoksa yedege) tasinir (focusAfterClose).
 */
function useReturnFocus(
  shown: boolean,
  focusInside: boolean,
  ids: { readonly target: string; readonly fallback: string },
): void {
  const wasShown = useRef(shown);
  const hadFocus = useRef(focusInside);
  useEffect(() => {
    if (shown) {
      hadFocus.current = focusInside;
    }
  }, [shown, focusInside]);
  useEffect(() => {
    const active = document.activeElement;
    const target = document.getElementById(ids.target);
    const decision = focusAfterClose({
      closed: wasShown.current && !shown,
      focusWasInside: hadFocus.current,
      activeIsPage: active === null || active === document.body,
      // Pasif dugme odak almaz: o zaman yedege (code-review).
      targetAvailable: target !== null && !(target instanceof HTMLButtonElement && target.disabled),
    });
    // Odak tasinirken sayfa kaydirilmaz (fareyle X'e basan kullanicinin sayfasi ziplamaz).
    if (decision === 'target') {
      target?.focus({ preventScroll: true });
    } else if (decision === 'fallback') {
      const fallback = document.getElementById(ids.fallback) ?? document.querySelector('h1');
      if (fallback instanceof HTMLElement) {
        fallback.focus({ preventScroll: true });
      }
    }
    wasShown.current = shown;
  }, [shown, ids.target, ids.fallback]);
}

/**
 * Son yerlesen hata: yeniden istek surerken (TanStack verisiz yeniden istekte
 * hatayi null yapar) onceki hata korunur; basari ya da bosta hatasizlik onu
 * siler. Pencere "yukleniyor" ile "alinamadi" arasinda titremez (code-review).
 */
function useSettledError(error: unknown, isFetching: boolean): unknown {
  const settled = useRef<unknown>(null);
  if (error !== null) {
    settled.current = error;
  } else if (!isFetching) {
    settled.current = null;
  }
  return settled.current;
}
