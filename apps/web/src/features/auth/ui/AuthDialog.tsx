import { useId, useLayoutEffect, useRef } from 'react';
import type { ReactNode } from 'react';

import styles from './AuthDialog.module.css';
import { CloseIcon } from './icons';

interface AuthDialogProps {
  /** Pencere basligi (icerikten: "Giris yap", "Kayit ol"). */
  readonly title: string;
  /** Kapat (X) dugmesinin erisilebilir adi (icerikten). */
  readonly closeLabel: string;
  readonly onClose: () => void;
  /** Alttaki gri bant: karsi pencereye gecis. */
  readonly footer: ReactNode;
  readonly children: ReactNode;
}

/**
 * Giris ve kayit penceresi (T11.6; referans: getir.com): bulunulan ekranin
 * ustunde acilir. Tarayicinin <dialog> ogesi showModal ile acilir: odak
 * pencerede kalir, arka plan etkisizdir, Esc kapatir. Arka plana (karartma)
 * tiklamak ve X dugmesi de kapatir; kapatmanin ne yapacagini sayfa bilir.
 *
 * showModal useLayoutEffect'te: formlarin odak efekti (useEffect) ondan SONRA
 * calisir, boylece tarayicinin "ilk odaklanabilir oge" secimi (X dugmesi)
 * formun sectigi alani ezmez.
 */
export function AuthDialog({ title, closeLabel, onClose, footer, children }: AuthDialogProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useLayoutEffect(() => {
    const element = dialog.current;
    if (element !== null && !element.open) {
      element.showModal();
    }
    return () => element?.close();
  }, []);

  return (
    <dialog
      ref={dialog}
      className={styles['c-auth-dialog']}
      aria-labelledby={titleId}
      onCancel={(event) => {
        // Esc: pencereyi tarayici degil sayfa kapatir (adres degisir).
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        // Yalnizca karartmaya tiklama: icerik pencerenin tamamini kaplar.
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div className={styles['c-auth-dialog__panel']}>
        <div className={styles['c-auth-dialog__header']}>
          <h2 id={titleId} className={styles['c-auth-dialog__title']}>
            {title}
          </h2>
          <button
            type="button"
            className={styles['c-auth-dialog__close']}
            aria-label={closeLabel}
            onClick={onClose}
          >
            <CloseIcon />
          </button>
        </div>
        <div className={styles['c-auth-dialog__body']}>{children}</div>
        <div className={styles['c-auth-dialog__footer']}>{footer}</div>
      </div>
    </dialog>
  );
}
