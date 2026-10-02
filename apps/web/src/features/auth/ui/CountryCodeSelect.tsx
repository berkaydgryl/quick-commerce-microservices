import type { PhoneCountry } from '@getir/contracts';

import styles from './CountryCodeSelect.module.css';
import { ChevronDownIcon } from './icons';

interface CountryCodeSelectProps {
  readonly id: string;
  /** Erisilebilir ad (icerikten: "Ulke kodu"). */
  readonly label: string;
  readonly countries: readonly PhoneCountry[];
  /** Secili ulkenin kodu ("TR"). */
  readonly value: string;
  readonly onChange: (code: string) => void;
}

/**
 * Ulke kodu secicisi (T11.6; referans: [bayrak +90 ▾]). Gorunen kutu bayrak,
 * kod ve oktur; ustunde seffaf, GERCEK bir <select> durur: klavye, ekran
 * okuyucu ve telefonun yerel secim listesi kendiliginden calisir. Odak halkasi
 * kutuya cizilir (select seffaf oldugu icin kendi halkasi gorunmezdi).
 */
export function CountryCodeSelect({
  id,
  label,
  countries,
  value,
  onChange,
}: CountryCodeSelectProps) {
  const selected = countries.find((country) => country.code === value) ?? countries[0];
  if (selected === undefined) {
    return null;
  }
  return (
    <div className={styles['c-country-select']}>
      <img className={styles['c-country-select__flag']} src={selected.flagUrl} alt="" />
      <span className={styles['c-country-select__dial']} aria-hidden="true">
        {selected.dialCode}
      </span>
      <span className={styles['c-country-select__chevron']}>
        <ChevronDownIcon />
      </span>
      <select
        id={id}
        className={styles['c-country-select__native']}
        aria-label={label}
        value={selected.code}
        onChange={(event) => onChange(event.target.value)}
      >
        {countries.map((country) => (
          <option key={country.code} value={country.code}>
            {country.name} ({country.dialCode})
          </option>
        ))}
      </select>
    </div>
  );
}
