import type { PhoneDialogContent } from '@getir/contracts';
import { useState } from 'react';

import { formatPhone } from '../../auth/services/phone';
import { useSendPhoneCode } from '../hooks/usePhoneVerification';
import { codeWindow } from '../services/code-window';
import type { CodeWindow } from '../services/code-window';
import { phoneFeedback } from '../services/phone-forms';

import styles from './ProfileDialog.module.css';

interface PhoneVerifyStartProps {
  readonly texts: PhoneDialogContent;
  /** Simdiki numara (E.164). */
  readonly phone: string;
  readonly onSent: (window: CodeWindow) => void;
}

/**
 * Simdiki numarayi dogrulama (T11.14 PR 3, "Doğrula"): sifre sorulmaz; numara
 * gosterilir, "Kod gönder" ile kod adimina gecilir.
 */
export function PhoneVerifyStart({ texts, phone, onSent }: PhoneVerifyStartProps) {
  const send = useSendPhoneCode();
  const [message, setMessage] = useState<string | null>(null);

  const start = async (): Promise<void> => {
    setMessage(null);
    try {
      const sent = await send.mutateAsync({ phone });
      onSent(codeWindow(sent.phone, sent, Date.now()));
    } catch (error) {
      const feedback = phoneFeedback(error, [] as const);
      setMessage(feedback.message);
    }
  };

  return (
    <div className={styles['c-profile-dialog']}>
      <p className={styles['c-profile-dialog__description']}>
        {texts.verifyDescription}
        <span className={styles['c-profile-dialog__address']}>{formatPhone(phone)}</span>
      </p>
      {message !== null && (
        <p className={styles['c-profile-dialog__alert']} role="alert">
          {message}
        </p>
      )}
      <button
        type="button"
        className={styles['c-profile-dialog__submit']}
        disabled={send.isPending}
        onClick={() => void start()}
      >
        {send.isPending ? texts.sendingLabel : texts.sendLabel}
      </button>
    </div>
  );
}
