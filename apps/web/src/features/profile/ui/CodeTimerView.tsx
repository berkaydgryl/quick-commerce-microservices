import type { EmailDialogContent } from '@getir/contracts';

import { formatCountdown } from '../services/code-window';

import styles from './EmailDialog.module.css';

export interface CodeTimerViewProps {
  readonly texts: EmailDialogContent;
  /** Kodun gecerliligine kalan saniye; 0 ise sure doldu. */
  readonly expiresIn: number;
  /** Yeni kod icin kalan saniye; 0 ise istenebilir. */
  readonly resendIn: number;
  /** Yeni kod istegi suruyor. */
  readonly resending: boolean;
  readonly onResend: () => void;
}

/**
 * Kod adiminin zamanlari (T11.14): gecerlilik geri sayimi ("Kodun geçerlilik
 * süresi 9:41"; dolunca uyari) ve yeni kod dugmesi (bekleme bitene kadar
 * kapali, kalan sure yazili). Geri sayim saniyede bir degisir ama duyurulmaz;
 * yalnizca "suresi doldu" uyarisi duyurulur (role=status). Durumsuz.
 */
export function CodeTimerView({
  texts,
  expiresIn,
  resendIn,
  resending,
  onResend,
}: CodeTimerViewProps) {
  return (
    <div className={styles['c-email-dialog__timer']}>
      {expiresIn > 0 ? (
        <p>
          {texts.expiresInLabel}{' '}
          <span className={styles['c-email-dialog__countdown']}>{formatCountdown(expiresIn)}</span>
        </p>
      ) : (
        <p className={styles['c-email-dialog__expired']} role="status">
          {texts.expiredNotice}
        </p>
      )}
      <button
        type="button"
        className={styles['c-email-dialog__link']}
        disabled={resendIn > 0 || resending}
        onClick={onResend}
      >
        {resendIn > 0 ? `${texts.resendWaitLabel} ${formatCountdown(resendIn)}` : texts.resendLabel}
      </button>
    </div>
  );
}
