import type { CheckoutContent } from '@getir/contracts';
import { useId, useState } from 'react';

import { Dialog } from '../../../shared/ui/dialog/Dialog';
import { FormAlert } from '../../cards/ui/FormAlert';
import { formatCountdown, isCountdownWarning } from '../services/countdown';
import { canSubmitCode, OTP_LENGTH } from '../services/three-ds-code';

import styles from './ThreeDsDialog.module.css';

export type ThreeDsTexts = Pick<
  CheckoutContent,
  | 'threeDsTitle'
  | 'threeDsDescription'
  | 'threeDsCodeLabel'
  | 'threeDsSubmitLabel'
  | 'threeDsSubmittingLabel'
  | 'threeDsCancelLabel'
  | 'threeDsRemainingLabel'
  | 'threeDsLastSecondsNotice'
  | 'threeDsAttemptsLeftSuffix'
  | 'threeDsRateLimitedNotice'
  | 'retryWaitLabel'
>;

interface ThreeDsDialogProps {
  readonly texts: ThreeDsTexts;
  /** Kalan saniye (useCountdown); sure bilinmiyorsa undefined (sayac gosterilmez). */
  readonly remaining: number | undefined;
  readonly verifying: boolean;
  readonly failure: { readonly message: string; readonly attemptsLeft: number } | undefined;
  /**
   * Yenilemede surdurulen 3DS'te sunucunun kalan hakki (F15b, #163): yanlis kod
   * cumlesi yokken gosterilir. Istemci sayi uydurmaz; sunucu vermediyse yok.
   */
  readonly attemptsLeft?: number | undefined;
  /** Cok fazla hatali kod (429; F15b): tekrar denemeye kalan saniye; 0 ise yok. */
  readonly waitSeconds?: number | undefined;
  readonly onSubmit: (otp: string) => void;
  /** "Vazgeç", sag ustteki X ve Esc AYNI yol (rezervasyon birakilir). */
  readonly onCancel: () => void;
}

/**
 * 3DS penceresi (T12.4; T17.1 geri sayim): bankanin 6 haneli kodu, kalan
 * sure (son 30 saniyede uyari rengi; ekran okuyucu "Son 30 saniye"yi BIR kez
 * okur), yanlis kodda sunucunun cumlesi ve kalan hak (yenilemede surdurulende
 * sunucunun kalan hakki, F15b). Kod SIRDIR: yalnizca
 * bu alanin durumunda yasar, her denemeden sonra silinir, pencere kapaninca
 * kaybolur; gunluge, depoya ve adrese yazilmaz. Ortak pencere: odak icinde
 * (showModal), Esc "Vazgeç" ile ayni.
 */
export function ThreeDsDialog({
  texts,
  remaining,
  verifying,
  failure,
  attemptsLeft,
  waitSeconds = 0,
  onSubmit,
  onCancel,
}: ThreeDsDialogProps) {
  const id = useId();
  const [otp, setOtp] = useState('');
  const warning = remaining !== undefined && isCountdownWarning(remaining);
  const failureId = `${id}-hata`;
  const ready = canSubmitCode(otp, verifying, waitSeconds);

  return (
    <Dialog
      title={texts.threeDsTitle}
      close={{ label: texts.threeDsCancelLabel, onAction: onCancel }}
    >
      <form
        className={styles['c-three-ds']}
        onSubmit={(event) => {
          event.preventDefault();
          if (ready) {
            onSubmit(otp);
            setOtp('');
          }
        }}
      >
        <p>{texts.threeDsDescription}</p>
        {remaining !== undefined && (
          <p className={styles['c-three-ds__timer']}>
            <span>{texts.threeDsRemainingLabel}</span>
            <span
              role="timer"
              className={
                warning
                  ? `${styles['c-three-ds__time']} ${styles['is-warning']}`
                  : styles['c-three-ds__time']
              }
            >
              {formatCountdown(remaining)}
            </span>
          </p>
        )}
        <p className={styles['c-three-ds__sr']} aria-live="polite">
          {warning ? texts.threeDsLastSecondsNotice : ''}
        </p>
        <label htmlFor={`${id}-kod`} className={styles['c-three-ds__label']}>
          {texts.threeDsCodeLabel}
        </label>
        <input
          id={`${id}-kod`}
          className={styles['c-three-ds__input']}
          value={otp}
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={OTP_LENGTH}
          aria-invalid={failure !== undefined}
          aria-describedby={failure === undefined ? undefined : failureId}
          onChange={(event) => setOtp(event.target.value.replace(/\D/g, '').slice(0, OTP_LENGTH))}
        />
        {failure !== undefined && (
          <p id={failureId} className={styles['c-three-ds__failure']}>
            {failure.message} {failure.attemptsLeft} {texts.threeDsAttemptsLeftSuffix}
          </p>
        )}
        {failure === undefined && attemptsLeft !== undefined && (
          <p className={styles['c-three-ds__attempts']}>
            {attemptsLeft} {texts.threeDsAttemptsLeftSuffix}
          </p>
        )}
        {waitSeconds > 0 && (
          <FormAlert
            message={texts.threeDsRateLimitedNotice}
            waitLabel={texts.retryWaitLabel}
            waitSeconds={waitSeconds}
          />
        )}
        <div className={styles['c-three-ds__actions']}>
          <button type="button" className={styles['c-three-ds__cancel']} onClick={onCancel}>
            {texts.threeDsCancelLabel}
          </button>
          <button type="submit" className={styles['c-three-ds__submit']} disabled={!ready}>
            {verifying ? texts.threeDsSubmittingLabel : texts.threeDsSubmitLabel}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
