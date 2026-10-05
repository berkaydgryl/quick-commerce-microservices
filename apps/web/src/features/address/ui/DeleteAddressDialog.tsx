import type { AddressesContent, SavedAddress } from '@getir/contracts';

import { AddressDialog } from './AddressDialog';
import styles from './DeleteAddressDialog.module.css';

interface DeleteAddressDialogProps {
  readonly texts: AddressesContent;
  /** Kapat (X) dugmesinin erisilebilir adi (icerikten). */
  readonly closeLabel: string;
  readonly address: SavedAddress;
  /** Silme suruyor: dugmeler bekler. */
  readonly pending: boolean;
  /** Sunucunun cumlesi (ag, 404); yoksa null. */
  readonly error: string | null;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
}

/**
 * Silme onayi (T11.15, T5): kucuk pencere. "<ad> adresini silmek istiyor
 * musun?", altinda siparislerin etkilenmedigi; "Vazgeç" ve "Sil". X ve Esc
 * vazgecer. Durumsuz: silmeyi sayfa yapar.
 */
export function DeleteAddressDialog({
  texts,
  closeLabel,
  address,
  pending,
  error,
  onConfirm,
  onCancel,
}: DeleteAddressDialogProps) {
  return (
    <AddressDialog
      title={texts.confirmTitle}
      close={{ label: closeLabel, onAction: onCancel, disabled: pending }}
    >
      <div className={styles['c-delete-address']}>
        <p className={styles['c-delete-address__question']}>
          <strong className={styles['c-delete-address__name']}>{address.title}</strong>{' '}
          {texts.confirmQuestionSuffix}
        </p>
        <p className={styles['c-delete-address__hint']}>{texts.confirmHint}</p>
        {error !== null && (
          <p className={styles['c-delete-address__alert']} role="alert">
            {error}
          </p>
        )}
        <div className={styles['c-delete-address__actions']}>
          <button
            type="button"
            className={styles['c-delete-address__cancel']}
            disabled={pending}
            onClick={onCancel}
          >
            {texts.cancelLabel}
          </button>
          <button
            type="button"
            className={styles['c-delete-address__confirm']}
            disabled={pending}
            aria-busy={pending}
            onClick={onConfirm}
          >
            {pending ? texts.deletingLabel : texts.confirmLabel}
          </button>
        </div>
      </div>
    </AddressDialog>
  );
}
