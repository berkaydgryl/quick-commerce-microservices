import type { AddressKind, AddressKindOption } from '@getir/contracts';

import { ChevronDownIcon } from './icons';
import styles from './KindSelect.module.css';

interface KindSelectProps {
  readonly id: string;
  /** Erisilebilir ad (icerikten: "Adres turu"). */
  readonly label: string;
  readonly kinds: readonly AddressKindOption[];
  readonly value: AddressKind;
  readonly onChange: (kind: AddressKind) => void;
}

/**
 * Adres turu secicisi (T11.8; referans: [🏠 ▾] basligin solunda). Gorunen kutu
 * ikon ve oktur; ustunde seffaf, GERCEK bir <select> durur (ulke kodu
 * secicisiyle ayni yontem): klavye, ekran okuyucu ve telefonun yerel listesi
 * kendiliginden calisir.
 */
export function KindSelect({ id, label, kinds, value, onChange }: KindSelectProps) {
  const selected = kinds.find((option) => option.kind === value) ?? kinds[0];
  if (selected === undefined) {
    return null;
  }
  return (
    <div className={styles['c-kind-select']}>
      <span className={styles['c-kind-select__icon']} aria-hidden="true">
        {selected.icon}
      </span>
      <span className={styles['c-kind-select__chevron']}>
        <ChevronDownIcon />
      </span>
      <select
        id={id}
        className={styles['c-kind-select__native']}
        aria-label={label}
        value={selected.kind}
        onChange={(event) => {
          const next = kinds.find((option) => option.kind === event.target.value);
          if (next !== undefined) {
            onChange(next.kind);
          }
        }}
      >
        {kinds.map((option) => (
          <option key={option.kind} value={option.kind}>
            {option.icon} {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}
