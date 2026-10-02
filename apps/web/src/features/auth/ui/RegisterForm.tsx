import type { LoginCardContent, RegisterRequest } from '@getir/contracts';
import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect, useMemo, useState } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';

import { useRegister } from '../hooks/useRegister';
import { countryByCode, countryByDialCode } from '../services/country';
import { REGISTER_FIELDS, registerFormSchema } from '../services/form-schemas';
import type { RegisterFormValues } from '../services/form-schemas';
import type { PhoneEntry } from '../services/auth-route-state';
import { formFeedback } from '../services/server-errors';

import { AuthField } from './AuthField';
import styles from './AuthForm.module.css';
import { CountryCodeSelect } from './CountryCodeSelect';
import { focusFirstInvalid, showServerErrors } from './form-errors';
import { PasswordField } from './PasswordField';
import { PhoneField } from './PhoneField';
import { PhoneRow } from './PhoneRow';

interface RegisterFormProps {
  readonly content: LoginCardContent;
  /** Giris penceresinden gelen numara: form dolu acilir. */
  readonly initialEntry: PhoneEntry | null;
  /** Yazilan numara (bossa null): pencerenin alt bandi giris penceresine tasir. */
  readonly onPhoneChange: (entry: PhoneEntry | null) => void;
}

/**
 * Kayit formu (T8.5; T11.6'dan beri kayit penceresinde, ulke kodu seciciyle):
 * ad soyad, telefon ve sifre; acilinca ad soyada odaklanir. Kayitli numara
 * PHONE_ALREADY_REGISTERED ile telefon alaninin altinda gorunur.
 */
export function RegisterForm({ content, initialEntry, onPhoneChange }: RegisterFormProps) {
  const registration = useRegister();
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
  const schema = useMemo(() => registerFormSchema(dialCode), [dialCode]);
  const {
    control,
    register,
    handleSubmit,
    setError,
    setFocus,
    formState: { errors, isSubmitting },
  } = useForm<RegisterFormValues, unknown, RegisterRequest>({
    resolver: zodResolver(schema),
    defaultValues: { fullName: '', phone: initialEntry?.digits ?? '', password: '' },
    // Odak sirasi form-errors.ts'te: react-hook-form kayit sirasiyla gezer.
    shouldFocusError: false,
  });
  const phoneDigits = useWatch({ control, name: 'phone' });

  useEffect(() => {
    setFocus('fullName');
  }, [setFocus]);

  useEffect(() => {
    onPhoneChange(phoneDigits === '' ? null : { dialCode, digits: phoneDigits });
  }, [phoneDigits, dialCode, onPhoneChange]);

  const submit = async (request: RegisterRequest): Promise<void> => {
    setFormMessage(null);
    try {
      await registration.mutateAsync(request);
    } catch (error) {
      const feedback = formFeedback(error, REGISTER_FIELDS);
      showServerErrors(REGISTER_FIELDS, feedback.fields, setError);
      setFormMessage(feedback.message);
    }
  };

  const { register: text } = content;
  return (
    <form
      className={styles['c-auth-form']}
      noValidate
      onSubmit={(event) =>
        void handleSubmit(submit, (invalid) =>
          focusFirstInvalid(REGISTER_FIELDS, invalid, setFocus),
        )(event)
      }
    >
      {formMessage !== null && (
        <p className={styles['c-auth-form__alert']} role="alert">
          {formMessage}
        </p>
      )}
      <AuthField
        id="kayit-ad"
        label={text.fullNameLabel}
        autoComplete="name"
        error={errors.fullName?.message}
        {...register('fullName')}
      />
      <PhoneRow>
        <CountryCodeSelect
          id="kayit-ulke"
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
              id="kayit-telefon"
              name={field.name}
              label={content.phoneLabel}
              placeholder={content.phonePlaceholder}
              autoComplete="tel-national"
              value={field.value}
              onChange={field.onChange}
              onBlur={field.onBlur}
              error={fieldState.error?.message}
            />
          )}
        />
      </PhoneRow>
      <PasswordField
        id="kayit-sifre"
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
