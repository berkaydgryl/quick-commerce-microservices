import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import type { z } from 'zod';

import { AuthField } from '../../auth/ui/AuthField';
import { focusFirstInvalid } from '../../auth/ui/form-errors';
import { useNow } from '../hooks/useNow';
import { codeDigits } from '../services/code-input';
import type { CodeStepFeedback, CodeStepTexts } from '../services/code-step';
import { secondsUntil } from '../services/code-window';
import type { CodeWindow } from '../services/code-window';
import { codeFormSchema } from '../services/email-forms';
import type { CodeFormValues } from '../services/email-forms';

import { CodeTimerView } from './CodeTimerView';
import styles from './ProfileDialog.module.css';

/** Formun alanlari, ekrandaki sirayla. */
const CODE_FIELD = ['code'] as const;

interface CodeFormProps {
  readonly texts: CodeStepTexts;
  /** Adresi degistirme baglantisinin metni ("E-posta adresini değiştir"). */
  readonly changeLabel: string;
  /** Ekranda gosterilen adres: e-posta ya da bicimli numara. */
  readonly displayAddress: string;
  readonly window: CodeWindow;
  /** Kodu sunucuda dogrular; hata firlatir. */
  readonly verify: (code: string) => Promise<void>;
  /** Yeni kod ister; yeni pencereyi ust bilesen yazar. Hata firlatir. */
  readonly resend: () => Promise<void>;
  /** Sunucu hatasinin kod alanina ve formun ustune dagitimi (kanala gore). */
  readonly feedback: (error: unknown) => CodeStepFeedback;
  readonly onChangeAddress: () => void;
  readonly onVerified: () => void;
}

/**
 * Kod adimi (T11.14; PR 3'ten beri e-posta ve telefon ortak): "Doğrulama kodunu
 * şu adrese gönderdik: ...", 6 haneli kod (yalnizca rakam; one-time-code),
 * gecerlilik geri sayimi ve 60 saniye sonra "Kodu yeniden gönder". Yanlis,
 * kilitli ya da suresi dolmus kodun cumlesi sunucudan gelir ve alanin altinda
 * gorunur; adres bu arada baska hesapta dogrulandiysa formun ustunde. Hangi
 * uca gidildigini ust bilesen verir (verify, resend).
 */
export function CodeForm({
  texts,
  changeLabel,
  displayAddress,
  window,
  verify,
  resend,
  feedback,
  onChangeAddress,
  onVerified,
}: CodeFormProps) {
  const now = useNow(true);
  const [formMessage, setFormMessage] = useState<string | null>(null);
  const [resending, setResending] = useState(false);
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
      await verify(code);
      onVerified();
    } catch (error) {
      const result = feedback(error);
      if (result.code !== undefined) {
        setError('code', { type: 'server', message: result.code }, { shouldFocus: true });
      }
      setFormMessage(result.message);
    }
  };

  const requestNewCode = async (): Promise<void> => {
    setFormMessage(null);
    setResending(true);
    try {
      await resend();
      resetField('code');
      setFocus('code');
    } catch (error) {
      const result = feedback(error);
      setFormMessage(result.message ?? result.code ?? null);
    } finally {
      setResending(false);
    }
  };

  return (
    <form
      className={styles['c-profile-dialog']}
      noValidate
      onSubmit={(event) =>
        void handleSubmit(submit, (invalid) => focusFirstInvalid(CODE_FIELD, invalid, setFocus))(
          event,
        )
      }
    >
      <p className={styles['c-profile-dialog__description']}>
        {texts.codeSentToLabel}
        <span className={styles['c-profile-dialog__address']}>{displayAddress}</span>
      </p>
      {formMessage !== null && (
        <p className={styles['c-profile-dialog__alert']} role="alert">
          {formMessage}
        </p>
      )}
      <Controller
        name="code"
        control={control}
        render={({ field, fieldState }) => (
          <AuthField
            ref={field.ref}
            id="dogrulama-kod"
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
        className={styles['c-profile-dialog__submit']}
        disabled={isSubmitting || expiresIn === 0}
      >
        {isSubmitting ? texts.verifyingLabel : texts.verifyLabel}
      </button>
      <CodeTimerView
        texts={texts}
        expiresIn={expiresIn}
        resendIn={resendIn}
        resending={resending}
        onResend={() => void requestNewCode()}
      />
      <button type="button" className={styles['c-profile-dialog__link']} onClick={onChangeAddress}>
        {changeLabel}
      </button>
    </form>
  );
}
