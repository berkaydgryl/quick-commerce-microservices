import { forwardRef } from 'react';

import { formatNationalPhone, nationalDigits } from '../services/phone';

import { AuthField } from './AuthField';
import type { AuthFieldProps } from './AuthField';

type PhoneFieldProps = Omit<AuthFieldProps, 'type' | 'prefix' | 'value' | 'onChange'> & {
  /** Ulke kodundan sonraki rakamlar (en fazla 10). */
  readonly value: string;
  readonly onChange: (digits: string) => void;
};

/**
 * Telefon alani (T8.5; T11.6'dan beri ulke kodu yaninda ayri seciciden gelir):
 * kullanici 10 rakami yazar, alan onlari "5XX XXX XX XX" duzeninde gosterir.
 * Yapistirilan "+90 ..." ya da "0532 ..." da ayni 10 rakama iner
 * (services/phone.ts).
 */
export const PhoneField = forwardRef<HTMLInputElement, PhoneFieldProps>(function PhoneField(
  { value, onChange, ...props },
  ref,
) {
  return (
    <AuthField
      ref={ref}
      {...props}
      type="tel"
      inputMode="numeric"
      value={formatNationalPhone(value)}
      onChange={(event) => onChange(nationalDigits(event.target.value))}
    />
  );
});
