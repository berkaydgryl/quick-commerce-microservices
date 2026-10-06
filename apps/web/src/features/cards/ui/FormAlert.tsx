import { formatCountdown } from '../../profile/services/code-window';

import styles from './FormAlert.module.css';

interface FormAlertProps {
  /** Formun ustundeki cumle (sunucu ya da sozluk). */
  readonly message: string;
  /** Cok fazla deneme (429): geri sayimin basi ve kalan saniye; yoksa 0. */
  readonly waitLabel: string;
  readonly waitSeconds: number;
}

/**
 * Kart formunun ustundeki uyari (T11.17). Cumle canli bolgede (role="alert",
 * bir kez okunur); 429 geri sayimi bolgenin DISINDA (QA C2): ekran okuyucu
 * her saniye konusmaz, istenince okur (profilin kod sayaci gibi).
 */
export function FormAlert({ message, waitLabel, waitSeconds }: FormAlertProps) {
  return (
    <div className={styles['c-form-alert']}>
      <p role="alert">{message}</p>
      {waitSeconds > 0 && (
        <p className={styles['c-form-alert__wait']}>
          {waitLabel} <time>{formatCountdown(waitSeconds)}</time>
        </p>
      )}
    </div>
  );
}
