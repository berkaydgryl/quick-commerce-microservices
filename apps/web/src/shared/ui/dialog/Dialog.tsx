import { useId, useLayoutEffect, useRef } from 'react';
import type { ReactNode } from 'react';

import styles from './Dialog.module.css';
import { backdropAction, isOwnEvent } from './dialog-events';
import { BackIcon, CloseIcon } from './icons';
import { handleCancel, syncNativeClose } from './native-close';

/** Basliktaki bir dugme: geri (solda, ok) ya da kapat (sagda, X). */
export interface DialogAction {
  /** Erisilebilir ad (icerikten: "Geri", "Kapat"). */
  readonly label: string;
  readonly onAction: () => void;
  readonly disabled?: boolean;
}

interface DialogProps {
  /** Baslik; onay turunde gorunmez (pencerenin adi labelledBy'dan). */
  readonly title: string;
  /**
   * Onay turu (F13 ortak onay penceresi): baslik satiri ve X yok, dar kutu;
   * karartmaya tiklamak da iptaldir (close); kapaninca odak acan ogeye doner.
   */
  readonly variant?: 'default' | 'confirm' | undefined;
  /** Onay turunde pencerenin adini veren oge (soru). */
  readonly labelledBy?: string | undefined;
  /** Soldaki geri oku (detay adimi). */
  readonly back?: DialogAction | undefined;
  /** Sagdaki X. */
  readonly close?: DialogAction | undefined;
  /** Alttaki gri bant ("Baska bir adreste misin? Adres Ekle"). */
  readonly footer?: ReactNode;
  readonly children: ReactNode;
}

/**
 * Ortak pencere kabugu (T11.8'de adres penceresi olarak yazildi; T11.17'de
 * shared'a tasindi: adres, profil, kart silme ve kart saklama kosullari
 * kullanir; referans: getir.com "Teslimat Adresi Ekle"): sayfanin ustunde,
 * tarayicinin <dialog> ogesiyle (showModal: odak pencerede, arka plan
 * etkisiz). Esc once geri gider (detay adimi), geri yoksa kapatir; tarayici
 * pencereyi kendisi kapatirsa geri acilir (native-close.ts, QA O2).
 *
 * Giris penceresinden (AuthDialog) farki: karartmaya tiklamak KAPATMAZ.
 * Haritayi surukleyen fare pencerenin disinda birakilirsa tarayici bunu
 * karartmaya tiklama sayar; adres penceresi kaza ile kapanmamali (ilk adres
 * penceresinde kapatmak cikis demektir). Onay turunde (F13) karartma iptaldir:
 * icinde harita yok, kullanici istegi.
 */
export function Dialog({
  title,
  variant = 'default',
  labelledBy,
  back,
  close,
  footer,
  children,
}: DialogProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const confirm = variant === 'confirm';
  // Basma karartmada miydi: kutudan baslayan surukleme iptal sayilmasin (F13 inceleme).
  const pressedOnBackdrop = useRef(false);

  // Kapaninca odak acan ogeye tarayicinin kendisi doner (<dialog> close()).
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
      className={
        confirm ? `${styles['c-dialog']} ${styles['c-dialog--confirm']}` : styles['c-dialog']
      }
      aria-labelledby={confirm ? labelledBy : titleId}
      // Yalniz bu pencerenin olaylari: icindeki pencerenin (ust uste onay, F13)
      // cancel/close'u React agacinda yukari ulasir; dis pencereyi kapatmasin.
      onCancel={(event) => {
        if (isOwnEvent(event.target, event.currentTarget)) {
          handleCancel(event, escape);
        }
      }}
      // Onay turunde yalnizca karartmaya tiklama iptaldir: icerik kutuyu kaplar.
      onPointerDown={(event) => {
        pressedOnBackdrop.current = isOwnEvent(event.target, event.currentTarget);
      }}
      onClick={(event) =>
        backdropAction(
          confirm,
          pressedOnBackdrop.current,
          event.target,
          event.currentTarget,
          escape,
        )?.()
      }
      onClose={(event) => {
        // Tarayici kendisi kapattiysa (Chrome: ikinci Esc) durumu esitle (QA O2).
        if (isOwnEvent(event.target, event.currentTarget) && dialog.current !== null) {
          syncNativeClose(dialog.current, escape);
        }
      }}
    >
      {!confirm && (
        <div className={styles['c-dialog__header']}>
          {back !== undefined && (
            <button
              type="button"
              className={`${styles['c-dialog__action']} ${styles['c-dialog__action--back']}`}
              aria-label={back.label}
              disabled={back.disabled}
              onClick={back.onAction}
            >
              <BackIcon />
            </button>
          )}
          <h2 id={titleId} className={styles['c-dialog__title']}>
            {title}
          </h2>
          {close !== undefined && (
            <button
              type="button"
              className={`${styles['c-dialog__action']} ${styles['c-dialog__action--close']}`}
              aria-label={close.label}
              disabled={close.disabled}
              onClick={close.onAction}
            >
              <CloseIcon />
            </button>
          )}
        </div>
      )}
      <div className={styles['c-dialog__body']}>{children}</div>
      {footer !== undefined && <div className={styles['c-dialog__footer']}>{footer}</div>}
    </dialog>
  );
}
