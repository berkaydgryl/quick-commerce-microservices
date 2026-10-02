import { useId, useLayoutEffect, useRef } from 'react';
import type { ReactNode } from 'react';

import styles from './AddressDialog.module.css';
import { BackIcon, CloseIcon } from './icons';

/** Basliktaki tek dugme: 1. adimda kapat (X, sagda), 2. adimda geri (ok, solda). */
export interface AddressDialogAction {
  readonly kind: 'close' | 'back';
  /** Erisilebilir ad (icerikten: "Kapat", "Geri"). */
  readonly label: string;
  readonly onAction: () => void;
  readonly disabled?: boolean;
}

interface AddressDialogProps {
  readonly title: string;
  readonly action: AddressDialogAction;
  readonly children: ReactNode;
}

/**
 * Adres ekleme penceresi (T11.8; referans: getir.com "Teslimat Adresi Ekle"):
 * karsilama ekraninin ustunde, tarayicinin <dialog> ogesiyle (showModal: odak
 * pencerede, arka plan etkisiz). Esc basliktaki dugmeyle ayni isi yapar.
 *
 * Giris penceresinden (AuthDialog) farki: karartmaya tiklamak KAPATMAZ.
 * Haritayi surukleyen fare pencerenin disinda birakilirsa tarayici bunu
 * karartmaya tiklama sayar; kapatma burada cikis demek oldugu icin kaza ile
 * olmamali.
 */
export function AddressDialog({ title, action, children }: AddressDialogProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useLayoutEffect(() => {
    const element = dialog.current;
    if (element !== null && !element.open) {
      element.showModal();
    }
    return () => element?.close();
  }, []);

  const button = (
    <button
      type="button"
      className={`${styles['c-address-dialog__action']} ${
        styles[
          action.kind === 'close'
            ? 'c-address-dialog__action--close'
            : 'c-address-dialog__action--back'
        ]
      }`}
      aria-label={action.label}
      disabled={action.disabled}
      onClick={action.onAction}
    >
      {action.kind === 'close' ? <CloseIcon /> : <BackIcon />}
    </button>
  );

  return (
    <dialog
      ref={dialog}
      className={styles['c-address-dialog']}
      aria-labelledby={titleId}
      onCancel={(event) => {
        // Esc: tarayici kapatmasin; basliktaki dugmeyle ayni is.
        event.preventDefault();
        if (action.disabled !== true) {
          action.onAction();
        }
      }}
    >
      <div className={styles['c-address-dialog__header']}>
        <h2 id={titleId} className={styles['c-address-dialog__title']}>
          {title}
        </h2>
        {button}
      </div>
      <div className={styles['c-address-dialog__body']}>{children}</div>
    </dialog>
  );
}
