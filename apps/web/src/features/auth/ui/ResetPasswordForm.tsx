import type { LoginCardContent, ResetPasswordRequest } from '@getir/contracts';
import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect, useMemo, useState } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';

import { usePhoneRegistration } from '../hooks/usePhoneRegistration';
import { useResetPassword } from '../hooks/useResetPassword';
import { countryByCode, countryByDialCode } from '../services/country';
import {
  completePhone,
  earlyPhoneProblem,
  RESET_PASSWORD_FIELDS,
  resetPasswordFormSchema,
} from '../services/form-schemas';
import type { ResetPasswordFormValues } from '../services/form-schemas';
import type { PhoneEntry } from '../services/auth-route-state';
import { formFeedback } from '../services/server-errors';

import styles from './AuthForm.module.css';
import { CountryCodeSelect } from './CountryCodeSelect';
import { focusFirstInvalid, showServerErrors } from './form-errors';
import { PasswordField } from './PasswordField';
import { PhoneField } from './PhoneField';
import { PhoneNotice } from './PhoneNotice';
import type { AuthSwitchTarget } from './PhoneNotice';
import { PhoneRow } from './PhoneRow';

interface ResetPasswordFormProps {
  readonly content: LoginCardContent;
  /** Giris penceresinden ya da karttan gelen numara: form dolu acilir. */
  readonly initialEntry: PhoneEntry | null;
  /** Yazilan numara (bossa null): pencerenin alt bandi giris penceresine tasir. */
  readonly onPhoneChange: (entry: PhoneEntry | null) => void;
  /** Kayitsiz numara uyarisindaki "Kayit ol" baglantisi. */
  readonly registerSwitch: AuthSwitchTarget;
}

/**
 * Sifre yenileme formu (T11.9; demo akisi, kullanicinin karari): telefon ve
 * yeni sifre. Kod sorulmaz; uc ve bu form yalnizca gelistirmede vardir.
 * Basarili yenileme oturumu acar (eski oturumlar kapanir); yonlendirmeyi
 * sayfa yapar. Numara geldiyse sifreye, gelmediyse telefona odaklanir.
 * Kayitsiz numara yazilinca giris penceresindeki uyari cikar.
 */
export function ResetPasswordForm({
  content,
  initialEntry,
  onPhoneChange,
  registerSwitch,
}: ResetPasswordFormProps) {
  const reset = useResetPassword();
  const [formMessage, setFormMessage] = useState<string | null>(null);
  const [countryCode, setCountryCode] = useState(
    () =>
      (initialEntry === null
        ? undefined
        : countryByDialCode(content.countries, initialEntry.dialCode)?.code) ??
      content.countries[0]?.code ??
      '',
  );
  const dialCode = countryByCode(content.countries, countryCode)?.dialCode ?? '';
  const schema = useMemo(() => resetPasswordFormSchema(dialCode), [dialCode]);
  const {
    control,
    register,
    handleSubmit,
    setError,
    setFocus,
    formState: { errors, isSubmitting },
  } = useForm<ResetPasswordFormValues, unknown, ResetPasswordRequest>({
    resolver: zodResolver(schema),
    defaultValues: { phone: initialEntry?.digits ?? '', password: '' },
    // Odak sirasi form-errors.ts'te: react-hook-form kayit sirasiyla gezer.
    shouldFocusError: false,
  });
  const phoneDigits = useWatch({ control, name: 'phone' });
  const registered = usePhoneRegistration(completePhone(phoneDigits, dialCode));
  const startsWithPhone = initialEntry === null;

  useEffect(() => {
    setFocus(startsWithPhone ? 'phone' : 'password');
  }, [setFocus, startsWithPhone]);

  useEffect(() => {
    onPhoneChange(phoneDigits === '' ? null : { dialCode, digits: phoneDigits });
  }, [phoneDigits, dialCode, onPhoneChange]);

  const submit = async (request: ResetPasswordRequest): Promise<void> => {
    setFormMessage(null);
    try {
      await reset.mutateAsync(request);
    } catch (error) {
      const feedback = formFeedback(error, RESET_PASSWORD_FIELDS);
      showServerErrors(RESET_PASSWORD_FIELDS, feedback.fields, setError);
      setFormMessage(feedback.message);
    }
  };

  const { resetPassword: text } = content;
  return (
    <form
      className={styles['c-auth-form']}
      noValidate
      onSubmit={(event) =>
        void handleSubmit(submit, (invalid) =>
          focusFirstInvalid(RESET_PASSWORD_FIELDS, invalid, setFocus),
        )(event)
      }
    >
      <p className={styles['c-auth-form__description']}>{text.description}</p>
      {formMessage !== null && (
        <p className={styles['c-auth-form__alert']} role="alert">
          {formMessage}
        </p>
      )}
      <PhoneRow>
        <CountryCodeSelect
          id="yenile-ulke"
          label={content.countryLabel}
          countries={content.countries}
          value={countryCode}
          onChange={setCountryCode}
        />
        <Controller
          name="phone"
          control={control}
          render={({ field, fieldState }) => (
            <PhoneField
              ref={field.ref}
              id="yenile-telefon"
              name={field.name}
              label={content.phoneLabel}
              placeholder={content.phonePlaceholder}
              autoComplete="tel-national"
              value={field.value}
              onChange={field.onChange}
              onBlur={field.onBlur}
              error={fieldState.error?.message ?? earlyPhoneProblem(field.value, dialCode)}
            />
          )}
        />
      </PhoneRow>
      {registered === false && errors.phone === undefined && (
        <PhoneNotice
          message={content.login.unknownPhoneNotice}
          linkLabel={content.login.registerLinkLabel}
          target={registerSwitch}
        />
      )}
      <PasswordField
        id="yenile-sifre"
        label={text.passwordLabel}
        toggleLabel={content.showPasswordLabel}
        autoComplete="new-password"
        error={errors.password?.message}
        {...register('password')}
      />
      <button type="submit" className={styles['c-auth-form__submit']} disabled={isSubmitting}>
        {isSubmitting ? text.pendingLabel : text.submitLabel}
      </button>
    </form>
  );
}
