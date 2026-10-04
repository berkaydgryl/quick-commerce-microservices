import type { StoreType } from '@getir/contracts';

import type { StoreTypeEntry } from '../services/store-type-filter';

import styles from './StoreTypeChips.module.css';

interface StoreTypeChipsProps {
  /** Grubun erisilebilir adi ("Kategoriler"). */
  readonly label: string;
  readonly allLabel: string;
  readonly entries: readonly StoreTypeEntry[];
  readonly selected: StoreType | undefined;
  readonly onSelect: (type: StoreType | undefined) => void;
}

/**
 * Tablet ve telefonda sol menunun yerine (T11.12): yatay kayan cip satiri.
 * Ilki "Tümü" (suzgec yok); sonra adreste marketi olan turler, menudeki sirayla.
 */
export function StoreTypeChips({
  label,
  allLabel,
  entries,
  selected,
  onSelect,
}: StoreTypeChipsProps) {
  const chip = (active: boolean) =>
    active
      ? `${styles['c-store-chips__chip']} ${styles['is-active']}`
      : styles['c-store-chips__chip'];

  return (
    <div className={styles['c-store-chips']} role="group" aria-label={label}>
      <button
        type="button"
        className={chip(selected === undefined)}
        aria-pressed={selected === undefined}
        onClick={() => onSelect(undefined)}
      >
        {allLabel}
      </button>
      {entries.map((entry) => (
        <button
          key={entry.type}
          type="button"
          className={chip(entry.type === selected)}
          aria-pressed={entry.type === selected}
          onClick={() => onSelect(entry.type)}
        >
          {entry.label}
          <span className={styles['c-store-chips__count']}>{entry.count}</span>
        </button>
      ))}
    </div>
  );
}
