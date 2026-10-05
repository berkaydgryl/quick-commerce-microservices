import type { PhoneDialogContent } from '@getir/contracts';
import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';

import { PHONE_COUNTRY_PREFIX } from '../../auth/services/phone';
import { focusFirstInvalid, showServerErrors } from '../../auth/ui/form-errors';
import { PasswordField } from '../../auth/ui/PasswordField';
import { PhoneField } from '../../auth/ui/PhoneField';
import { useSendPhoneCode } from '../hooks/usePhoneVerification';
import { codeWindow } from '../services/code-window';
import type { CodeWindow } from '../services/code-window';
import { PHONE_CHANGE_FIELDS, phoneChangeFormSchema, phoneFeedback } from '../services/phone-forms';
import type { PhoneChangeFormValues, PhoneChangeRequest } from '../services/phone-forms';

import styles from './ProfileDialog.module.css';

interface PhoneFormProps {
  readonly texts: PhoneDialogContent;
  /** Kod adimindan "başka bir numara" ile donulduyse onceki numaranin rakamlari. */
  readonly initialDigits: string;
  /** Kod gitti: kod adimina gecilir. */
  readonly onSent: (window: CodeWindow) => void;
}

/**
 * Numara degistirme adimi (T11.14 PR 3): yeni numara (+90 ve 10 rakam) ve
 * simdiki sifre, "Kod gönder". Telefon giris kimligidir: sifre sorulur.
 * Yanlis sifre sifrenin, baska hesaptaki numara numaranin altinda; erken
 * yeniden gonderme formun ustunde (kalan saniye).
 */
export function PhoneForm({ texts, initialDigits, onSent }: PhoneFormProps) {
  const send = useSendPhoneCode();
  const [formMessage, setFormMessage] = useState<string | null>(null);
  const {
    control,
    register,
    handleSubmit,
    setError,
    setFocus,
    formState: { errors, isSubmitting },
  } = useForm<PhoneChangeFormValues, unknown, PhoneChangeRequest>({
    resolver: zodResolver(phoneChangeFormSchema),
    defaultValues: { phone: initialDigits, password: '' },
    shouldFocusError: false,
  });

  useEffect(() => {
    setFocus('phone');
  }, [setFocus]);

  const submit = async (request: PhoneChangeRequest): Promise<void> => {
    setFormMessage(null);
    try {
      const sent = await send.mutateAsync(request);
      onSent(codeWindow(sent.phone, sent, Date.now()));
    } catch (error) {
      const feedback = phoneFeedback(error, PHONE_CHANGE_FIELDS);
      showServerErrors(PHONE_CHANGE_FIELDS, feedback.fields, setError);
      setFormMessage(feedback.message);
    }
  };

  return (
    <form
      className={styles['c-profile-dialog']}
      noValidate
      onSubmit={(event) =>
        void handleSubmit(submit, (invalid) =>
          focusFirstInvalid(PHONE_CHANGE_FIELDS, invalid, setFocus),
        )(event)
      }
    >
      <p className={styles['c-profile-dialog__description']}>{texts.changeDescription}</p>
      {formMessage !== null && (
        <p className={styles['c-profile-dialog__alert']} role="alert">
          {formMessage}
        </p>
      )}
      <Controller
        name="phone"
        control={control}
        render={({ field, fieldState }) => (
          <PhoneField
            ref={field.ref}
            id="telefon-yeni"
            name={field.name}
            label={texts.phoneFieldLabel}
            prefix={PHONE_COUNTRY_PREFIX}
            autoComplete="tel-national"
            value={field.value}
            onChange={field.onChange}
            onBlur={field.onBlur}
            error={fieldState.error?.message}
          />
        )}
      />
      <PasswordField
        id="telefon-sifre"
        label={texts.passwordLabel}
        showLabel={texts.showPasswordLabel}
        hideLabel={texts.hidePasswordLabel}
        autoComplete="current-password"
        error={errors.password?.message}
        {...register('password')}
      />
      <button type="submit" className={styles['c-profile-dialog__submit']} disabled={isSubmitting}>
        {isSubmitting ? texts.sendingLabel : texts.sendLabel}
      </button>
    </form>
  );
}
