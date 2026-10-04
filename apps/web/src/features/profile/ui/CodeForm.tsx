import type { EmailDialogContent } from '@getir/contracts';
import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import type { z } from 'zod';

import { formFeedback } from '../../auth/services/server-errors';
import { AuthField } from '../../auth/ui/AuthField';
import { focusFirstInvalid, showServerErrors } from '../../auth/ui/form-errors';
import { useNow } from '../hooks/useNow';
import { useSendEmailCode } from '../hooks/useSendEmailCode';
import { useVerifyEmail } from '../hooks/useVerifyEmail';
import { codeDigits } from '../services/code-input';
import { codeWindow, secondsUntil } from '../services/code-window';
import type { CodeWindow } from '../services/code-window';
import { CODE_FORM_FIELDS, codeFormSchema } from '../services/email-forms';
import type { CodeFormValues } from '../services/email-forms';

import { CodeTimerView } from './CodeTimerView';
import styles from './EmailDialog.module.css';

/** Formun alanlari, ekrandaki sirayla (adresin alani bu formda yok). */
const CODE_FIELD = ['code'] as const;

interface CodeFormProps {
  readonly userId: string;
  readonly texts: EmailDialogContent;
  /** Gonderilen kodun adresi ve sureleri. */
  readonly window: CodeWindow;
  /** Yeni kod gitti: sureler bastan. */
  readonly onResent: (window: CodeWindow) => void;
  readonly onChangeEmail: () => void;
  readonly onVerified: () => void;
}

/**
 * Kod adimi (T11.14): "Doğrulama kodunu şu adrese gönderdik: ...", 6 haneli
 * kod (yalnizca rakam; telefonun SMS/e-posta onerisi icin one-time-code),
 * gecerlilik geri sayimi ve 60 saniye sonra "Kodu yeniden gönder". Yanlis,
 * kilitli ya da suresi dolmus kodun cumlesi sunucudan gelir ve alanin altinda
 * gorunur; adres bu arada baska hesapta dogrulandiysa formun ustunde.
 */
export function CodeForm({
  userId,
  texts,
  window,
  onResent,
  onChangeEmail,
  onVerified,
}: CodeFormProps) {
  const verify = useVerifyEmail(userId);
  const resend = useSendEmailCode();
  const now = useNow(true);
  const [formMessage, setFormMessage] = useState<string | null>(null);
  const {
    control,
    handleSubmit,
    setError,
    setFocus,
    resetField,
    formState: { isSubmitting },
  } = useForm<CodeFormValues, unknown, z.output<typeof codeFormSchema>>({
    resolver: zodResolver(codeFormSchema),
    defaultValues: { code: '' },
    shouldFocusError: false,
  });
  const expiresIn = secondsUntil(window.expiresAt, now);
  const resendIn = secondsUntil(window.resendAt, now);

  useEffect(() => {
    setFocus('code');
  }, [setFocus]);

  const submit = async ({ code }: { readonly code: string }): Promise<void> => {
    setFormMessage(null);
    try {
      await verify.mutateAsync({ email: window.email, code });
      onVerified();
    } catch (error) {
      const feedback = formFeedback(error, CODE_FORM_FIELDS);
      showServerErrors(CODE_FIELD, feedback.fields, setError);
      setFormMessage(feedback.fields.email ?? feedback.message);
    }
  };

  const requestNewCode = async (): Promise<void> => {
    setFormMessage(null);
    try {
      const sent = await resend.mutateAsync({ email: window.email });
      onResent(codeWindow(sent, Date.now()));
      resetField('code');
      setFocus('code');
    } catch (error) {
      const feedback = formFeedback(error, CODE_FORM_FIELDS);
      setFormMessage(feedback.fields.email ?? feedback.message);
    }
  };

  return (
    <form
      className={styles['c-email-dialog']}
      noValidate
      onSubmit={(event) =>
        void handleSubmit(submit, (invalid) => focusFirstInvalid(CODE_FIELD, invalid, setFocus))(
          event,
        )
      }
    >
      <p className={styles['c-email-dialog__description']}>
        {texts.codeSentToLabel}
        <span className={styles['c-email-dialog__address']}>{window.email}</span>
      </p>
      {formMessage !== null && (
        <p className={styles['c-email-dialog__alert']} role="alert">
          {formMessage}
        </p>
      )}
      <Controller
        name="code"
        control={control}
        render={({ field, fieldState }) => (
          <AuthField
            ref={field.ref}
            id="eposta-kod"
            name={field.name}
            label={texts.codeFieldLabel}
            inputMode="numeric"
            autoComplete="one-time-code"
            value={field.value}
            onChange={(event) => field.onChange(codeDigits(event.target.value))}
            onBlur={field.onBlur}
            error={fieldState.error?.message}
          />
        )}
      />
      <button
        type="submit"
        className={styles['c-email-dialog__submit']}
        disabled={isSubmitting || expiresIn === 0}
      >
        {isSubmitting ? texts.verifyingLabel : texts.verifyLabel}
      </button>
      <CodeTimerView
        texts={texts}
        expiresIn={expiresIn}
        resendIn={resendIn}
        resending={resend.isPending}
        onResend={() => void requestNewCode()}
      />
      <button type="button" className={styles['c-email-dialog__link']} onClick={onChangeEmail}>
        {texts.changeEmailLabel}
      </button>
    </form>
  );
}
