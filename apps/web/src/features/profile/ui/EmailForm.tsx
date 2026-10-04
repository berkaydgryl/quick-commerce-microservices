import type { EmailDialogContent, SendEmailCodeRequest } from '@getir/contracts';
import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';

import { formFeedback } from '../../auth/services/server-errors';
import { AuthField } from '../../auth/ui/AuthField';
import { focusFirstInvalid, showServerErrors } from '../../auth/ui/form-errors';
import { useSendEmailCode } from '../hooks/useSendEmailCode';
import { codeWindow } from '../services/code-window';
import type { CodeWindow } from '../services/code-window';
import { EMAIL_FORM_FIELDS, emailFormSchema } from '../services/email-forms';
import type { EmailFormValues } from '../services/email-forms';

import styles from './ProfileDialog.module.css';

interface EmailFormProps {
  readonly texts: EmailDialogContent;
  /** Kod adimindan "adresi degistir" ile donulduyse onceki adres. */
  readonly initialEmail: string;
  /** Kod gitti: kod adimina gecilir. */
  readonly onSent: (window: CodeWindow) => void;
}

/**
 * Adres adimi (T11.14): adres yazilir, "Kod gönder". Bicim kurali sozlesmeden;
 * adres baska hesapta ya da zaten bu hesaptaysa sunucunun cumlesi alanin
 * altinda; yeni kod icin bekleme bitmediyse formun ustunde kalan saniye.
 */
export function EmailForm({ texts, initialEmail, onSent }: EmailFormProps) {
  const send = useSendEmailCode();
  const [formMessage, setFormMessage] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    setError,
    setFocus,
    formState: { errors, isSubmitting },
  } = useForm<EmailFormValues, unknown, SendEmailCodeRequest>({
    resolver: zodResolver(emailFormSchema),
    defaultValues: { email: initialEmail },
    shouldFocusError: false,
  });

  useEffect(() => {
    setFocus('email');
  }, [setFocus]);

  const submit = async (request: SendEmailCodeRequest): Promise<void> => {
    setFormMessage(null);
    try {
      const sent = await send.mutateAsync(request);
      onSent(codeWindow(sent.email, sent, Date.now()));
    } catch (error) {
      const feedback = formFeedback(error, EMAIL_FORM_FIELDS);
      showServerErrors(EMAIL_FORM_FIELDS, feedback.fields, setError);
      setFormMessage(feedback.message);
    }
  };

  return (
    <form
      className={styles['c-profile-dialog']}
      noValidate
      onSubmit={(event) =>
        void handleSubmit(submit, (invalid) =>
          focusFirstInvalid(EMAIL_FORM_FIELDS, invalid, setFocus),
        )(event)
      }
    >
      <p className={styles['c-profile-dialog__description']}>{texts.emailDescription}</p>
      {formMessage !== null && (
        <p className={styles['c-profile-dialog__alert']} role="alert">
          {formMessage}
        </p>
      )}
      <AuthField
        id="eposta-adres"
        label={texts.emailFieldLabel}
        type="email"
        inputMode="email"
        autoComplete="email"
        error={errors.email?.message}
        {...register('email')}
      />
      <button type="submit" className={styles['c-profile-dialog__submit']} disabled={isSubmitting}>
        {isSubmitting ? texts.sendingLabel : texts.sendLabel}
      </button>
    </form>
  );
}
