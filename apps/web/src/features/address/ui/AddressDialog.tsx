import { useId, useLayoutEffect, useRef } from 'react';
import type { ReactNode } from 'react';

import styles from './AddressDialog.module.css';
import { BackIcon, CloseIcon } from './icons';

/** Basliktaki bir dugme: geri (solda, ok) ya da kapat (sagda, X). */
export interface AddressDialogAction {
  /** Erisilebilir ad (icerikten: "Geri", "Kapat"). */
  readonly label: string;
  readonly onAction: () => void;
  readonly disabled?: boolean;
}

interface AddressDialogProps {
  readonly title: string;
  /** Soldaki geri oku (detay adimi). */
  readonly back?: AddressDialogAction | undefined;
  /** Sagdaki X. */
  readonly close?: AddressDialogAction | undefined;
  /** Alttaki gri bant ("Baska bir adreste misin? Adres Ekle"). */
  readonly footer?: ReactNode;
  readonly children: ReactNode;
}

/**
 * Adres pencereleri (T11.8, T11.10; referans: getir.com "Teslimat Adresi Ekle",
 * "Adreslerim"): sayfanin ustunde, tarayicinin <dialog> ogesiyle (showModal:
 * odak pencerede, arka plan etkisiz). Esc once geri gider (detay adimi), geri
 * yoksa kapatir.
 *
 * Giris penceresinden (AuthDialog) farki: karartmaya tiklamak KAPATMAZ.
 * Haritayi surukleyen fare pencerenin disinda birakilirsa tarayici bunu
 * karartmaya tiklama sayar; adres penceresi kaza ile kapanmamali (ilk adres
 * penceresinde kapatmak cikis demektir).
 */
export function AddressDialog({ title, back, close, footer, children }: AddressDialogProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useLayoutEffect(() => {
    const element = dialog.current;
    if (element !== null && !element.open) {
      element.showModal();
    }
    return () => element?.close();
  }, []);

  const escape = back ?? close;
  return (
    <dialog
      ref={dialog}
      className={styles['c-address-dialog']}
      aria-labelledby={titleId}
      onCancel={(event) => {
        // Esc: tarayici kapatmasin; geri ya da kapat dugmesiyle ayni is.
        event.preventDefault();
        if (escape !== undefined && escape.disabled !== true) {
          escape.onAction();
        }
      }}
    >
      <div className={styles['c-address-dialog__header']}>
        {back !== undefined && (
          <button
            type="button"
            className={`${styles['c-address-dialog__action']} ${styles['c-address-dialog__action--back']}`}
            aria-label={back.label}
            disabled={back.disabled}
            onClick={back.onAction}
          >
            <BackIcon />
          </button>
        )}
        <h2 id={titleId} className={styles['c-address-dialog__title']}>
          {title}
        </h2>
        {close !== undefined && (
          <button
            type="button"
            className={`${styles['c-address-dialog__action']} ${styles['c-address-dialog__action--close']}`}
            aria-label={close.label}
            disabled={close.disabled}
            onClick={close.onAction}
          >
            <CloseIcon />
          </button>
        )}
      </div>
      <div className={styles['c-address-dialog__body']}>{children}</div>
      {footer !== undefined && <div className={styles['c-address-dialog__footer']}>{footer}</div>}
    </dialog>
  );
}
