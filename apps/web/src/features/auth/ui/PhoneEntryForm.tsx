import type { LoginCardContent } from '@getir/contracts';
import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect, useMemo, useState } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';

import { countryByCode } from '../services/country';
import { phoneEntrySchema } from '../services/form-schemas';
import type { PhoneEntryOutput, PhoneEntryValues } from '../services/form-schemas';
import type { PhoneEntry } from '../services/auth-route-state';

import styles from './AuthForm.module.css';
import { CountryCodeSelect } from './CountryCodeSelect';
import { PhoneField } from './PhoneField';
import { PhoneRow } from './PhoneRow';

interface PhoneEntryFormProps {
  readonly content: LoginCardContent;
  /** Gecerli numara: sayfa giris penceresini acar, numara orada dolu gelir. */
  readonly onAccepted: (entry: PhoneEntry) => void;
  /** Yazilan numara (bossa null): kartin "Kayit ol" baglantisi kayit penceresine tasir. */
  readonly onPhoneChange: (entry: PhoneEntry | null) => void;
}

/**
 * Karsilama kartinin formu (T11.6): ulke kodu + numara + "Devam Et". Kural ve
 * mesaj sozlesmeden; sayfa ilk acildiginda odaklanmaz (telefonda klavye
 * kendiliginden acilmasin).
 */
export function PhoneEntryForm({ content, onAccepted, onPhoneChange }: PhoneEntryFormProps) {
  const [countryCode, setCountryCode] = useState(() => content.countries[0]?.code ?? '');
  const dialCode = countryByCode(content.countries, countryCode)?.dialCode ?? '';
  const schema = useMemo(() => phoneEntrySchema(dialCode), [dialCode]);
  const { control, handleSubmit, getValues, setFocus } = useForm<
    PhoneEntryValues,
    unknown,
    PhoneEntryOutput
  >({
    resolver: zodResolver(schema),
    defaultValues: { phone: '' },
    shouldFocusError: false,
  });
  const phoneDigits = useWatch({ control, name: 'phone' });

  useEffect(() => {
    onPhoneChange(phoneDigits === '' ? null : { dialCode, digits: phoneDigits });
  }, [phoneDigits, dialCode, onPhoneChange]);

  return (
    <form
      className={styles['c-auth-form']}
      noValidate
      onSubmit={(event) =>
        void handleSubmit(
          () => onAccepted({ dialCode, digits: getValues('phone') }),
          () => setFocus('phone'),
        )(event)
      }
    >
      <PhoneRow>
        <CountryCodeSelect
          id="karsilama-ulke"
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
              id="karsilama-telefon"
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
      <button type="submit" className={styles['c-auth-form__submit']}>
        {content.continueLabel}
      </button>
    </form>
  );
}
