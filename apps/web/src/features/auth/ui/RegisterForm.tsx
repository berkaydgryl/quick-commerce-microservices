import type { RegisterRequest } from '@getir/contracts';
import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { Link } from 'react-router-dom';

import { useRegister } from '../hooks/useRegister';
import { EMPTY_REGISTER_FORM, REGISTER_FIELDS, registerFormSchema } from '../services/form-schemas';
import type { RegisterFormValues } from '../services/form-schemas';
import { formFeedback } from '../services/server-errors';

import { AuthField } from './AuthField';
import styles from './AuthForm.module.css';
import { focusFirstInvalid, showServerErrors } from './form-errors';
import { PasswordField } from './PasswordField';
import { PhoneField } from './PhoneField';

interface RegisterFormProps {
  /** Giris ekraninin adresi; donus adresini tasir. */
  readonly loginPath: string;
}

/**
 * Kayit formu (T8.5): ad soyad, telefon ve sifre; giris formuyla ayni duzen.
 * Kayitli numara PHONE_ALREADY_REGISTERED ile telefon alaninin altinda gorunur.
 */
export function RegisterForm({ loginPath }: RegisterFormProps) {
  const registration = useRegister();
  const [formMessage, setFormMessage] = useState<string | null>(null);
  const {
    control,
    register,
    handleSubmit,
    setError,
    setFocus,
    formState: { errors, isSubmitting },
  } = useForm<RegisterFormValues, unknown, RegisterRequest>({
    resolver: zodResolver(registerFormSchema),
    defaultValues: EMPTY_REGISTER_FORM,
    // Odak sirasi form-errors.ts'te: react-hook-form kayit sirasiyla gezer.
    shouldFocusError: false,
  });

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

  return (
    <form
      className={styles['c-auth-form']}
      noValidate
      onSubmit={(event) =>
        void handleSubmit(submit, (errors) => focusFirstInvalid(REGISTER_FIELDS, errors, setFocus))(
          event,
        )
      }
    >
      {formMessage !== null && (
        <p className={styles['c-auth-form__alert']} role="alert">
          {formMessage}
        </p>
      )}
      <AuthField
        id="kayit-ad"
        label="Adın soyadın"
        autoComplete="name"
        error={errors.fullName?.message}
        {...register('fullName')}
      />
      <Controller
        name="phone"
        control={control}
        render={({ field, fieldState }) => (
          <PhoneField
            ref={field.ref}
            id="kayit-telefon"
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
        id="kayit-sifre"
        label="Şifren"
        autoComplete="new-password"
        error={errors.password?.message}
        {...register('password')}
      />
      <button type="submit" className={styles['c-auth-form__submit']} disabled={isSubmitting}>
        {isSubmitting ? 'Kaydın yapılıyor…' : 'Kayıt ol'}
      </button>
      <p className={styles['c-auth-form__switch']}>
        Zaten üye misin?{' '}
        <Link to={loginPath} className={styles['c-auth-form__switch-link']}>
          Giriş yap
        </Link>
      </p>
    </form>
  );
}
