import type { CourierTrackingContent, MapContent, OrderTracking } from '@getir/contracts';

import { Dialog } from '../../../shared/ui/dialog/Dialog';
import type { CourierMapState } from '../services/map-state';
import { courierDisplayName, distanceText, etaText } from '../services/tracking-format';

import styles from './CourierMapDialog.module.css';
import { LazyTrackingMap } from './LazyTrackingMap';

interface CourierMapDialogProps {
  readonly texts: CourierTrackingContent;
  /** Karo ve atif (adres haritasinin icerigi). */
  readonly map: Pick<MapContent, 'tileUrl' | 'attribution' | 'zoom'>;
  /** Siparisin teslimat adresi (satir). */
  readonly addressLine: string;
  readonly state: CourierMapState;
  readonly onRetry: () => void;
  readonly onClose: () => void;
}

/**
 * "Kuryem nerede" (F22): ortak pencere, ortada; basliginda "Kuryem nerede"
 * ve X. Ustte "Kuryen" ve kisaltilmis ad, ortada harita, altta tahmini varis
 * ve kalan mesafe, en altta teslimat adresi. Paket alinmadan (TO_MARKET)
 * konum yok, cumlesi gorunur; teslimde cumlesi, sure ve mesafe yok. Takip
 * yoksa ya da alinamadiysa cumle ve "Tekrar dene". Durumsuz.
 */
export function CourierMapDialog({
  texts,
  map,
  addressLine,
  state,
  onRetry,
  onClose,
}: CourierMapDialogProps) {
  return (
    <Dialog title={texts.title} close={{ label: texts.closeLabel, onAction: onClose }}>
      <div className={styles['c-courier-map']}>
        {state.kind === 'loading' && (
          <div className={styles['c-courier-map__placeholder']} aria-busy="true">
            <p className={styles['c-courier-map__notice']} role="status">
              {texts.loadingLabel}
            </p>
          </div>
        )}
        {state.kind === 'unavailable' && (
          <div className={styles['c-courier-map__unavailable']} role="alert">
            <p>{texts.unavailableNotice}</p>
            <button type="button" className={styles['c-courier-map__retry']} onClick={onRetry}>
              {texts.retryLabel}
            </button>
          </div>
        )}
        {state.kind === 'ready' && <ReadyView texts={texts} map={map} tracking={state.tracking} />}
        <p className={styles['c-courier-map__address']}>
          <span className={styles['c-courier-map__caption']}>{texts.addressLabel}</span>
          <span>{addressLine}</span>
        </p>
      </div>
    </Dialog>
  );
}

function ReadyView({
  texts,
  map,
  tracking,
}: {
  readonly texts: CourierTrackingContent;
  readonly map: CourierMapDialogProps['map'];
  readonly tracking: OrderTracking;
}) {
  const delivered = tracking.phase === 'DELIVERED';
  return (
    <>
      <p className={styles['c-courier-map__courier']}>
        <span className={styles['c-courier-map__caption']}>{texts.courierLabel}</span>
        <span className={styles['c-courier-map__name']}>
          {courierDisplayName(tracking.courier.name)}
        </span>
      </p>
      <LazyTrackingMap map={map} label={texts.mapLabel} tracking={tracking} texts={texts} />
      {tracking.phase === 'TO_MARKET' && (
        <p className={styles['c-courier-map__notice']}>{texts.pickupNotice}</p>
      )}
      {delivered ? (
        <p className={styles['c-courier-map__notice']}>{texts.deliveredNotice}</p>
      ) : (
        <dl className={styles['c-courier-map__facts']}>
          <div className={styles['c-courier-map__fact']}>
            <dt className={styles['c-courier-map__caption']}>{texts.etaLabel}</dt>
            <dd className={styles['c-courier-map__value']}>
              {etaText(tracking.etaSeconds, texts)}
            </dd>
          </div>
          <div className={styles['c-courier-map__fact']}>
            <dt className={styles['c-courier-map__caption']}>{texts.distanceLabel}</dt>
            <dd className={styles['c-courier-map__value']}>
              {distanceText(tracking.remainingMeters, texts)}
            </dd>
          </div>
        </dl>
      )}
    </>
  );
}
