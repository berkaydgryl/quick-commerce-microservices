import type {
  AddressesContent,
  AddressKind,
  AddressKindOption,
  SavedAddress,
} from '@getir/contracts';
import { useId } from 'react';

import { PinIcon, PlusIcon, TrashIcon } from '../../features/address/ui/icons';
import { kindIcon } from '../../features/address/ui/kind-icon';
import { EditIcon, VerifiedIcon } from '../../features/profile/ui/icons';
import { QueryError, QueryLoading } from '../../shared/ui/query-status/QueryStatus';

import styles from './AddressesView.module.css';

export interface AddressesViewProps {
  readonly texts: AddressesContent;
  /** Tur ikonlari (icerikten); icerik gelmediyse genel konum ikonu. */
  readonly kinds: readonly AddressKindOption[];
  /** Adres defteri; sorgu bitene kadar undefined. */
  readonly addresses: readonly SavedAddress[] | undefined;
  readonly error: Error | null;
  readonly onRetry: () => void;
  /** Gecerli teslimat adresinin kimligi; varsayilan adreste undefined. */
  readonly selectedId: string | undefined;
  /** Pencereler icin icerik yuklenmedi: duzenleme, silme ve ekleme bekler. */
  readonly actionsDisabled: boolean;
  readonly onSelect: (address: SavedAddress) => void;
  readonly onEdit: (address: SavedAddress) => void;
  readonly onDelete: (address: SavedAddress) => void;
  readonly onAdd: (kind: AddressKind) => void;
}

/**
 * Adreslerim (T11.15; gorsel dil profil kartinin, T11.14 PR 2): beyaz kartta
 * ince cizgilerle ayrilmis satirlar. Satir: tur ikonu, ad, adres satiri;
 * sagda secili adreste yesil onay, digerlerinde cop kutusu (T1: secili adres
 * duzenleme penceresinden silinir) ve her satirda kalem (T2). Satira tiklamak
 * adresi secer (T3): satirlar tarayicinin radyo grubudur (ok tuslari).
 * Altta "Ev / İş / Diğer adres ekle" (T4). Durumsuz.
 */
export function AddressesView({
  texts,
  kinds,
  addresses,
  error,
  onRetry,
  selectedId,
  actionsDisabled,
  onSelect,
  onEdit,
  onDelete,
  onAdd,
}: AddressesViewProps) {
  const titleId = useId();
  const groupName = useId();

  return (
    <section
      className={styles['c-addresses']}
      aria-labelledby={titleId}
      aria-busy={addresses === undefined && error === null}
    >
      <h1 id={titleId} className={styles['c-addresses__title']}>
        {texts.title}
      </h1>
      {addresses === undefined && error === null && (
        <QueryLoading>{texts.loadingLabel}</QueryLoading>
      )}
      {addresses === undefined && error !== null && <QueryError error={error} onRetry={onRetry} />}
      {addresses !== undefined && (
        <div className={styles['c-addresses__card']}>
          {addresses.length === 0 ? (
            <p className={styles['c-addresses__empty']}>{texts.emptyNotice}</p>
          ) : (
            <ul className={styles['c-addresses__list']} role="radiogroup" aria-labelledby={titleId}>
              {addresses.map((address) => {
                const selected = address.id === selectedId;
                return (
                  <li
                    key={address.id}
                    className={
                      selected
                        ? `${styles['c-addresses__row']} ${styles['is-selected']}`
                        : styles['c-addresses__row']
                    }
                  >
                    <label className={styles['c-addresses__choice']}>
                      <input
                        type="radio"
                        name={groupName}
                        className={styles['c-addresses__radio']}
                        checked={selected}
                        onChange={() => onSelect(address)}
                      />
                      <span className={styles['c-addresses__icon']} aria-hidden="true">
                        {kindIcon(kinds, address.kind) ?? <PinIcon />}
                      </span>
                      <span className={styles['c-addresses__text']}>
                        <span className={styles['c-addresses__name']}>{address.title}</span>
                        <span className={styles['c-addresses__line']}>{address.line}</span>
                      </span>
                    </label>
                    {selected ? (
                      <span
                        className={styles['c-addresses__selected']}
                        role="img"
                        aria-label={texts.selectedLabel}
                      >
                        <VerifiedIcon />
                      </span>
                    ) : (
                      <button
                        type="button"
                        className={styles['c-addresses__action']}
                        aria-label={`${address.title} ${texts.deleteSuffix}`}
                        disabled={actionsDisabled}
                        onClick={() => onDelete(address)}
                      >
                        <TrashIcon />
                      </button>
                    )}
                    <button
                      type="button"
                      className={styles['c-addresses__action']}
                      aria-label={`${address.title} ${texts.editSuffix}`}
                      disabled={actionsDisabled}
                      onClick={() => onEdit(address)}
                    >
                      <EditIcon />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          <ul className={styles['c-addresses__adds']} role="list">
            {texts.addOptions.map((option) => (
              <li key={option.kind}>
                <button
                  type="button"
                  className={styles['c-addresses__add']}
                  disabled={actionsDisabled}
                  onClick={() => onAdd(option.kind)}
                >
                  <span className={styles['c-addresses__add-icon']} aria-hidden="true">
                    <PlusIcon />
                  </span>
                  {option.label}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
