import { useId } from 'react';
import type { FocusEventHandler, Ref } from 'react';

import { ChevronDownIcon } from '../../address/ui/icons';

import { onlyWhenChanged } from '../services/changed-only';

import styles from './ExpirySelects.module.css';

/** Bir secim: deger, degisim ve odak (react-hook-form alani). */
export interface ExpirySelect {
  readonly id: string;
  readonly ref: Ref<HTMLSelectElement>;
  readonly name: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly onFocus: FocusEventHandler<HTMLSelectElement>;
  readonly onBlur: FocusEventHandler<HTMLSelectElement>;
  readonly invalid: boolean;
}

interface ExpirySelectsProps {
  /** "Kartın Son Kullanma Tarihi:". */
  /** Gorunen basligin kimligi ("Kartın Son Kullanma Tarihi:"); baslik satiri cagiranda (QA K3). */
  readonly labelledBy: string;
  readonly monthLabel: string;
  readonly yearLabel: string;
  /** Yillar sozlesmeden (cardExpiryYears: Turkiye takvimi, en fazla 20 yil ileri; QA C9). */
  readonly years: readonly number[];
  readonly month: ExpirySelect;
  readonly year: ExpirySelect;
  /** Ay ya da yilin hatasi (biri yeter): seçimlerin altinda. */
  readonly error: string | undefined;
}

const MONTHS = Array.from({ length: 12 }, (_, index) => String(index + 1).padStart(2, '0'));

/**
 * Son kullanma (T11.17; referans getircarsi): Ay ve Yil acilir secimleri,
 * altinda tek hata satiri. Gorunen baslik ("Kartın Son Kullanma Tarihi:")
 * cagiranin satirinda, CVV ile birlikte iki sutunun ustunde; grup adini
 * aria-labelledby ile ondan alir (QA K3: baslik telefonda iki satira
 * kirilsa da secimler ve CVV ayni hizadan baslar). Tarayicinin kendi secimi
 * (klavye ve ekran okuyucu hazir); ilk secenek yer tutucudur ("Ay", "Yıl").
 * Ok, adres ve ulke secicilerindeki gibi ChevronDownIcon (suslemedir).
 */
export function ExpirySelects({
  labelledBy,
  monthLabel,
  yearLabel,
  years,
  month,
  year,
  error,
}: ExpirySelectsProps) {
  const errorId = useId();
  const select = (field: ExpirySelect, label: string, options: readonly string[]) => (
    <span className={styles['c-expiry__control']}>
      <select
        ref={field.ref}
        id={field.id}
        name={field.name}
        aria-label={label}
        aria-invalid={field.invalid}
        aria-describedby={error === undefined ? undefined : errorId}
        className={
          field.value === ''
            ? `${styles['c-expiry__select']} ${styles['is-empty']}`
            : styles['c-expiry__select']
        }
        value={field.value}
        onChange={(event) => onlyWhenChanged(field.value, field.onChange)(event.target.value)}
        onFocus={field.onFocus}
        onBlur={field.onBlur}
      >
        <option value="" disabled>
          {label}
        </option>
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
      <span className={styles['c-expiry__chevron']} aria-hidden="true">
        <ChevronDownIcon />
      </span>
    </span>
  );
  return (
    <fieldset className={styles['c-expiry']} aria-labelledby={labelledBy}>
      <div className={styles['c-expiry__selects']}>
        {select(month, monthLabel, MONTHS)}
        {select(
          year,
          yearLabel,
          years.map((candidate) => String(candidate)),
        )}
      </div>
      {error !== undefined && (
        <p id={errorId} className={styles['c-expiry__error']}>
          {error}
        </p>
      )}
    </fieldset>
  );
}
