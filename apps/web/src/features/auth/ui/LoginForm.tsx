import type { LoginRequest } from '@getir/contracts';
import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import type { ReactNode } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { Link } from 'react-router-dom';

import { useLogin } from '../hooks/useLogin';
import { EMPTY_LOGIN_FORM, LOGIN_FIELDS, loginFormSchema } from '../services/form-schemas';
import type { LoginFormValues } from '../services/form-schemas';
import { fromE164 } from '../services/phone';
import { formFeedback } from '../services/server-errors';

import styles from './AuthForm.module.css';
import { focusFirstInvalid, showServerErrors } from './form-errors';
import { PasswordField } from './PasswordField';
import { PhoneField } from './PhoneField';

/** Formu disaridan dolduran bilgiler (gelistirmede persona secici). */
export interface LoginCredentials {
  /** E.164: "+905550000001". */
  readonly phone: string;
  readonly password: string;
}

interface LoginFormProps {
  /** Kayit ekraninin adresi; donus adresini tasir. */
  readonly registerPath: string;
  /** Formun altina eklenen parca; verilen fonksiyon formu doldurur, giris yapmaz. */
  readonly renderPrefill?:
    ((fill: (credentials: LoginCredentials) => void) => ReactNode) | undefined;
}

/**
 * Giris formu (T8.5): telefon ve sifre. Kurallar ve alan mesajlari sozlesmeden
 * (form-schemas.ts), sunucu hatasi sozlukten (server-errors.ts). Basarili giris
 * oturumu acar; yonlendirmeyi sayfa yapar.
 */
export function LoginForm({ registerPath, renderPrefill }: LoginFormProps) {
  const login = useLogin();
  const [formMessage, setFormMessage] = useState<string | null>(null);
  const {
    control,
    register,
    handleSubmit,
    setError,
    setFocus,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<LoginFormValues, unknown, LoginRequest>({
    resolver: zodResolver(loginFormSchema),
    defaultValues: EMPTY_LOGIN_FORM,
    // Odak sirasi form-errors.ts'te: react-hook-form kayit sirasiyla gezer.
    shouldFocusError: false,
  });

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
    setFormMessage(null);
    setValue('phone', fromE164(credentials.phone), { shouldValidate: true });
    setValue('password', credentials.password, { shouldValidate: true });
  };

  return (
    <>
      <form
        className={styles['c-auth-form']}
        noValidate
        onSubmit={(event) =>
          void handleSubmit(submit, (errors) => focusFirstInvalid(LOGIN_FIELDS, errors, setFocus))(
            event,
          )
        }
      >
        {formMessage !== null && (
          <p className={styles['c-auth-form__alert']} role="alert">
            {formMessage}
          </p>
        )}
        <Controller
          name="phone"
          control={control}
          render={({ field, fieldState }) => (
            <PhoneField
              ref={field.ref}
              id="giris-telefon"
              name={field.name}
              label="Telefon numaran"
              placeholder="5XX XXX XX XX"
              autoComplete="tel-national"
              value={field.value}
              onChange={field.onChange}
              onBlur={field.onBlur}
              error={fieldState.error?.message}
            />
          )}
        />
        <PasswordField
          id="giris-sifre"
          label="Şifren"
          autoComplete="current-password"
          error={errors.password?.message}
          {...register('password')}
        />
        <button type="submit" className={styles['c-auth-form__submit']} disabled={isSubmitting}>
          {isSubmitting ? 'Giriş yapılıyor…' : 'Giriş yap'}
        </button>
        <p className={styles['c-auth-form__switch']}>
          Henüz üye değil misin?{' '}
          <Link to={registerPath} className={styles['c-auth-form__switch-link']}>
            Şimdi kaydol
          </Link>
        </p>
      </form>
      {renderPrefill?.(fill)}
    </>
  );
}
