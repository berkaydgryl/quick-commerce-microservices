import type { OrderStatus } from '@getir/contracts';
import { useEffect, useRef } from 'react';

import { useAppHeaderContent } from '../../content/hooks/useAppHeaderContent';
import { useCourierTrackingContent } from '../../content/hooks/useCourierTrackingContent';
import { trackingMode } from '../api/queries';
import { useCourierApproach } from '../hooks/useCourierApproach';
import { useOrderTracking } from '../hooks/useOrderTracking';
import { courierMapState } from '../services/map-state';

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
}: CourierTrackingProps) {
  const texts = useCourierTrackingContent();
  const map = useAppHeaderContent()?.addressSetup.map;
  const mode = trackingMode(open, status);
  const tracking = useOrderTracking(userId, orderId, mode);
  const approach = useCourierApproach(orderId, tracking.data, open);
  const { refetch } = tracking;

  // Acilista hemen guncel konum; suren istek iptal edilmez (cift istek yok).
  useEffect(() => {
    if (open) {
      void refetch({ cancelRefetch: false });
    }
  }, [open, refetch]);

  // Pencere ya da bildirim kapaninca odak sayfaya dustuyse "Kuryem nerede"ye
  // (tarayici odagi acan ogeye dondurur; o oge bildirimse yok olmustur).
  useReturnFocus(open, returnFocusId);
  useReturnFocus(approach.visible, returnFocusId);

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
            onPause={approach.pause}
            onResume={approach.resume}
          />
        )}
      </div>
      {open && texts !== undefined && map !== undefined && (
        <CourierMapDialog
          texts={texts}
          map={map}
          addressLine={addressLine}
          state={courierMapState(tracking)}
          onRetry={() => void refetch()}
          onClose={() => onOpenChange(false)}
        />
      )}
    </>
  );
}

/** shown true'dan false'a donunce odak sayfaya dustuyse kimlikli ogeye tasinir. */
function useReturnFocus(shown: boolean, targetId: string): void {
  const wasShown = useRef(shown);
  useEffect(() => {
    if (wasShown.current && !shown) {
      const active = document.activeElement;
      if (active === null || active === document.body) {
        document.getElementById(targetId)?.focus();
      }
    }
    wasShown.current = shown;
  }, [shown, targetId]);
}
