import type { AddressKindOption, AppHeaderContent, SavedAddress } from '@getir/contracts';
import { useId, useState } from 'react';
import type { ReactNode } from 'react';

import { AddressButton } from './AddressButton';
import styles from './AddressBookDialog.module.css';
import { Dialog } from '../../../shared/ui/dialog/Dialog';
import { kindIcon } from './kind-icon';
import { PinIcon } from './icons';

interface AddressBookDialogProps {
  readonly content: AppHeaderContent;
  readonly kinds: readonly AddressKindOption[];
  /** X'in erisilebilir adi (icerikten). */
  readonly closeLabel: string;
  readonly addresses: readonly SavedAddress[];
  /** Gecerli adres (acilista secili gelir); defter bossa undefined. */
  readonly current: SavedAddress | undefined;
  /** Defter bos ya da okunamadi: liste yerine gosterilecek not. */
  readonly notice?: ReactNode;
  /** "Adresi Onayla": secilen adres gecerli olur, pencere kapanir. */
  readonly onConfirm: (address: SavedAddress) => void;
  /** "Adres Ekle": harita + detay penceresine gecilir. */
  readonly onAdd: () => void;
  readonly onClose: () => void;
}

/**
 * "Adreslerim" (T11.10; referans getircarsi): ust bardaki adrese tiklayinca
 * acilir. Her adres bir radyo satiri (ikon, ad, adres satiri); secim
 * "Adresi Onayla"ya kadar uygulanmaz, X ve Esc degistirmeden kapatir. Alt
 * bantta "Baska bir adreste misin? Adres Ekle". Radyolar tarayicinin kendi
 * grubudur: ok tuslariyla gezilir.
 */
export function AddressBookDialog({
  content,
  kinds,
  closeLabel,
  addresses,
  current,
  notice,
  onConfirm,
  onAdd,
  onClose,
}: AddressBookDialogProps) {
  const groupName = useId();
  const [picked, setPicked] = useState<number>(() =>
    current === undefined ? -1 : addresses.indexOf(current),
  );
  const pickedAddress = addresses[picked];

  return (
    <Dialog
      title={content.addressBookTitle}
      close={{ label: closeLabel, onAction: onClose }}
      footer={
        <p className={styles['c-address-book__add']}>
          {content.addressAddPrompt}{' '}
          <button type="button" className={styles['c-address-book__add-link']} onClick={onAdd}>
            {content.addressAddLabel}
          </button>
        </p>
      }
    >
      {notice ?? (
        <>
          <fieldset className={styles['c-address-book__list']}>
            <legend className={styles['c-address-book__legend']}>{content.addressListLabel}</legend>
            {addresses.map((address, index) => (
              <label key={address.id} className={styles['c-address-book__option']}>
                <input
                  type="radio"
                  name={groupName}
                  className={styles['c-address-book__radio']}
                  checked={index === picked}
                  onChange={() => setPicked(index)}
                />
                <span className={styles['c-address-book__icon']} aria-hidden="true">
                  {kindIcon(kinds, address.kind) ?? <PinIcon />}
                </span>
                <span className={styles['c-address-book__text']}>
                  <span className={styles['c-address-book__title']}>{address.title}</span>{' '}
                  <span className={styles['c-address-book__line']}>({address.line})</span>
                </span>
              </label>
            ))}
          </fieldset>
          <AddressButton
            disabled={pickedAddress === undefined}
            onClick={() => {
              if (pickedAddress !== undefined) {
                onConfirm(pickedAddress);
              }
            }}
          >
            {content.addressConfirmLabel}
          </AddressButton>
        </>
      )}
    </Dialog>
  );
}
