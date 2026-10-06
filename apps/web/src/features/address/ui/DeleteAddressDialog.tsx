import type { AddressesContent, SavedAddress } from '@getir/contracts';

import { ConfirmPanel } from '../../../shared/ui/confirm-panel/ConfirmPanel';

import { AddressDialog } from './AddressDialog';

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
 * vazgecer. Govde ortak (ConfirmPanel, T11.17'de kart silme de kullanir).
 * Durumsuz: silmeyi sayfa yapar.
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
      <ConfirmPanel
        subject={address.title}
        questionSuffix={texts.confirmQuestionSuffix}
        hint={texts.confirmHint}
        error={error}
        pending={pending}
        confirmLabel={texts.confirmLabel}
        pendingLabel={texts.deletingLabel}
        cancelLabel={texts.cancelLabel}
        onConfirm={onConfirm}
        onCancel={onCancel}
      />
    </AddressDialog>
  );
}
