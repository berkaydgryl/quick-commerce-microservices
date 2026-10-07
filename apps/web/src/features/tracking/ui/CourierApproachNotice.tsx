import type { CourierTrackingContent } from '@getir/contracts';

import { CloseIcon } from '../../../shared/ui/dialog/icons';

import styles from './CourierApproachNotice.module.css';

interface CourierApproachNoticeProps {
  readonly texts: Pick<
    CourierTrackingContent,
    'approachTitle' | 'approachActionLabel' | 'approachCloseLabel'
  >;
  /** "Konumu gör": kurye penceresini acar. */
  readonly onShow: () => void;
  readonly onClose: () => void;
  /** Fare ve odak ayri bildirilir: biri surerken digerinden cikmak sureyi baslatmaz. */
  readonly onHoverChange: (hovered: boolean) => void;
  readonly onFocusChange: (focused: boolean) => void;
}

/**
 * Yaklasma bildirimi (F22; kullanici istegi): sag ustte beyaz kart; sol
 * ustte X, "Kuryen konumuna yaklaştı!" ve "Konumu gör". Duyuru disaridaki
 * kalici durum bolgesinden (CourierTracking). Kapanma suresi kancada (15 sn;
 * fare ya da odak uzerindeyken durur).
 */
export function CourierApproachNotice({
  texts,
  onShow,
  onClose,
  onHoverChange,
  onFocusChange,
}: CourierApproachNoticeProps) {
  return (
    <div
      className={styles['c-approach-notice']}
      // mouseover: imlec bildirim belirdiginde zaten ustundeyse de ilk harekette durur.
      onMouseOver={() => onHoverChange(true)}
      onMouseLeave={() => onHoverChange(false)}
      onFocus={() => onFocusChange(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) {
          onFocusChange(false);
        }
      }}
    >
      <button
        type="button"
        className={styles['c-approach-notice__close']}
        aria-label={texts.approachCloseLabel}
        onClick={onClose}
      >
        <CloseIcon />
      </button>
      <p className={styles['c-approach-notice__title']}>{texts.approachTitle}</p>
      <button type="button" className={styles['c-approach-notice__action']} onClick={onShow}>
        {texts.approachActionLabel}
      </button>
    </div>
  );
}
