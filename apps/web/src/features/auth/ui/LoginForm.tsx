import type { LoginCardContent, LoginRequest } from '@getir/contracts';
import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';

import { useLogin } from '../hooks/useLogin';
import { usePhoneRegistration } from '../hooks/usePhoneRegistration';
import { countryByCode, countryByDialCode, countryOfPhone } from '../services/country';
import {
  completePhone,
  earlyPhoneProblem,
  LOGIN_FIELDS,
  loginFormSchema,
} from '../services/form-schemas';
import type { LoginField, LoginFormValues } from '../services/form-schemas';
import type { PhoneEntry } from '../services/auth-route-state';
import { formFeedback } from '../services/server-errors';

import styles from './AuthForm.module.css';
import { CountryCodeSelect } from './CountryCodeSelect';
import { ForgotPasswordLink } from './ForgotPasswordLink';
import { focusFirstInvalid, showServerErrors } from './form-errors';
import { PasswordField } from './PasswordField';
import { PhoneField } from './PhoneField';
import { PhoneNotice } from './PhoneNotice';
import type { AuthSwitchTarget } from './PhoneNotice';
import { PhoneRow } from './PhoneRow';

/** Formu disaridan dolduran bilgiler (gelistirmede demo hesaplar). */
export interface LoginCredentials {
  /** E.164: "+905550000001". */
  readonly phone: string;
  readonly password: string;
}

interface LoginFormProps {
  readonly content: LoginCardContent;
  /** Karsilama kartindan ya da kayit penceresinden gelen numara: form dolu acilir. */
  readonly initialEntry: PhoneEntry | null;
  /** Karsilama kartindaki demo hesaplardan acilinca demo sifresi (gelistirme); yoksa bos. */
  readonly initialPassword: string;
  /** Yazilan numara (bossa null): pencerenin alt bandi kayit penceresine tasir. */
  readonly onPhoneChange: (entry: PhoneEntry | null) => void;
  /** Kayitsiz numara uyarisindaki "Kayit ol" baglantisi (T11.7). */
  readonly registerSwitch: AuthSwitchTarget;
  /** "Sifremi unuttum" (T11.9): sifre alaninin altinda; verilmezse (production) yok. */
  readonly forgotPassword?: AuthSwitchTarget | undefined;
  /** Formun altina eklenen parca; verilen fonksiyon formu doldurur, giris yapmaz. */
  readonly renderPrefill?:
    ((fill: (credentials: LoginCredentials) => void) => ReactNode) | undefined;
}

/**
 * Giris formu (T8.5; T11.6'dan beri giris penceresinde, ulke kodu seciciyle):
 * telefon ve sifre. Numara geldiyse sifreye, gelmediyse telefona odaklanir.
 * Basarili giris oturumu acar; yonlendirmeyi sayfa yapar.
 */
export function LoginForm({
  content,
  initialEntry,
  initialPassword,
  onPhoneChange,
  registerSwitch,
  forgotPassword,
  renderPrefill,
}: LoginFormProps) {
  const login = useLogin();
  const [formMessage, setFormMessage] = useState<string | null>(null);
  const [countryCode, setCountryCode] = useState(
    () =>
      (initialEntry === null
        ? undefined
        : countryByDialCode(content.countries, initialEntry.dialCode)?.code) ??
      content.countries[0]?.code ??
      '',
  );
  const [firstField] = useState<LoginField>(() => (initialEntry === null ? 'phone' : 'password'));
  const dialCode = countryByCode(content.countries, countryCode)?.dialCode ?? '';
  const schema = useMemo(() => loginFormSchema(dialCode), [dialCode]);
  const {
    control,
    register,
    handleSubmit,
    setError,
    setFocus,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<LoginFormValues, unknown, LoginRequest>({
    resolver: zodResolver(schema),
    defaultValues: { phone: initialEntry?.digits ?? '', password: initialPassword },
    // Odak sirasi form-errors.ts'te: react-hook-form kayit sirasiyla gezer.
    shouldFocusError: false,
  });
  const phoneDigits = useWatch({ control, name: 'phone' });
  // Numara tamamlaninca sorulur (T11.7): kayitsizsa telefonun altinda uyari.
  const registered = usePhoneRegistration(completePhone(phoneDigits, dialCode));

  useEffect(() => {
    setFocus(firstField);
  }, [firstField, setFocus]);

  useEffect(() => {
    onPhoneChange(phoneDigits === '' ? null : { dialCode, digits: phoneDigits });
  }, [phoneDigits, dialCode, onPhoneChange]);

  const submit = async (request: LoginRequest): Promise<void> => {
    setFormMessage(null);
    try {
      await login.mutateAsync(request);
    } catch (error) {
      const feedback = formFeedback(error, LOGIN_FIELDS);
      showServerErrors(LOGIN_FIELDS, feedback.fields, setError);
      setFormMessage(feedback.message);
    }
  };

  const fill = (credentials: LoginCredentials): void => {
    const country = countryOfPhone(content.countries, credentials.phone);
    if (country === undefined) {
      return;
    }
    setFormMessage(null);
    setCountryCode(country.code);
    setValue('phone', credentials.phone.slice(country.dialCode.length), { shouldValidate: true });
    setValue('password', credentials.password, { shouldValidate: true });
  };

  const { login: text } = content;
  return (
    <>
      <form
        className={styles['c-auth-form']}
        noValidate
        onSubmit={(event) =>
          void handleSubmit(submit, (invalid) =>
            focusFirstInvalid(LOGIN_FIELDS, invalid, setFocus),
          )(event)
        }
      >
        {formMessage !== null && (
          <p className={styles['c-auth-form__alert']} role="alert">
            {formMessage}
          </p>
        )}
        <PhoneRow>
          <CountryCodeSelect
            id="giris-ulke"
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
                id="giris-telefon"
                name={field.name}
                label={content.phoneLabel}
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
            message={text.unknownPhoneNotice}
            linkLabel={text.registerLinkLabel}
            target={registerSwitch}
          />
        )}
        <PasswordField
          id="giris-sifre"
          label={text.passwordLabel}
          showLabel={content.showPasswordLabel}
          hideLabel={content.hidePasswordLabel}
          autoComplete="current-password"
          error={errors.password?.message}
          {...register('password')}
        />
        {forgotPassword !== undefined && (
          <ForgotPasswordLink
            label={content.forgotPasswordLabel}
            target={forgotPassword}
            align="end"
            replace
          />
        )}
        <button type="submit" className={styles['c-auth-form__submit']} disabled={isSubmitting}>
          {isSubmitting ? text.pendingLabel : text.submitLabel}
        </button>
      </form>
      {renderPrefill?.(fill)}
    </>
  );
}
