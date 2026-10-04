import type { StoreType } from '@getir/contracts';
import { useId, useState } from 'react';

import type { StoreTypeGroupEntry } from '../services/store-type-filter';

import { ChevronDownIcon } from './icons';
import styles from './StoreTypeMenu.module.css';

interface StoreTypeMenuProps {
  readonly groups: readonly StoreTypeGroupEntry[];
  readonly selected: StoreType | undefined;
  /** Secili ture yeniden basmak suzgeci kaldirir (undefined). */
  readonly onSelect: (type: StoreType | undefined) => void;
}

/**
 * Sol menu (T11.12; referans getircarsi "Kategoriler"): akordeon gruplar
 * (kucuk gorsel, ad, ok); acilan grup turlerini adresteki market sayisiyla
 * listeler, ture basmak listeyi suzer. Gruplar ve adlar icerikten gelir.
 * Acilista secili turun grubu acik, digerleri kapali.
 */
export function StoreTypeMenu({ groups, selected, onSelect }: StoreTypeMenuProps) {
  const baseId = useId();
  const [open, setOpen] = useState<ReadonlySet<string>>(
    () =>
      new Set(
        groups
          .filter((group) => group.types.some((entry) => entry.type === selected))
          .map((group) => group.label),
      ),
  );

  const toggle = (label: string): void => {
    setOpen((current) => {
      const next = new Set(current);
      if (next.has(label)) {
        next.delete(label);
      } else {
        next.add(label);
      }
      return next;
    });
  };

  return (
    <div className={styles['c-store-menu']}>
      <ul className={styles['c-store-menu__groups']} role="list">
        {groups.map((group, index) => {
          const expanded = open.has(group.label);
          const panelId = `${baseId}-${index}`;
          return (
            <li key={group.label}>
              <button
                type="button"
                className={styles['c-store-menu__row']}
                aria-expanded={expanded}
                aria-controls={panelId}
                onClick={() => toggle(group.label)}
              >
                <img
                  className={styles['c-store-menu__image']}
                  src={group.imageUrl}
                  alt=""
                  width={40}
                  height={40}
                />
                <span className={styles['c-store-menu__label']}>{group.label}</span>
                <span
                  className={`${styles['c-store-menu__chevron']} ${expanded ? styles['is-expanded'] : ''}`}
                >
                  <ChevronDownIcon />
                </span>
              </button>
              <ul
                id={panelId}
                className={styles['c-store-menu__types']}
                role="list"
                hidden={!expanded}
              >
                {group.types.map((entry) => {
                  const active = entry.type === selected;
                  return (
                    <li key={entry.type}>
                      <button
                        type="button"
                        className={`${styles['c-store-menu__type']} ${active ? styles['is-active'] : ''}`}
                        aria-pressed={active}
                        onClick={() => onSelect(active ? undefined : entry.type)}
                      >
                        <span>{entry.label}</span>
                        <span className={styles['c-store-menu__count']}>{entry.count}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
