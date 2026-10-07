import type { AddressesContent, SavedAddress } from '@getir/contracts';

import { ConfirmDialog } from '../../../shared/ui/confirm-panel/ConfirmDialog';
import { useConfirmContent } from '../../content/hooks/useConfirmContent';

interface DeleteAddressDialogProps {
  readonly texts: Pick<AddressesContent, 'confirmQuestion' | 'deletingLabel'>;
  readonly address: SavedAddress;
  /** Silme suruyor: dugmeler bekler. */
  readonly pending: boolean;
  /** Sunucunun cumlesi (ag, 404); yoksa null. */
  readonly error: string | null;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
}

/**
 * Adres silme onayi (T11.15, T5; F13 ortak onay penceresi): "Adresi silmek
 * istediğinden emin misin?", "Hayır" ve "Evet" (beklerken "Siliniyor…").
 * Gorunen soru duz (PM S1 (a)); ekran okuyucu arkasinda adin adini duyar
 * ("Ev"). Silmeyi sayfa yapar; etiketler icerikten (kanca).
 */
export function DeleteAddressDialog({
  texts,
  address,
  pending,
  error,
  onConfirm,
  onCancel,
}: DeleteAddressDialogProps) {
  const labels = useConfirmContent();
  return (
    <ConfirmDialog
      question={texts.confirmQuestion}
      spokenDetail={address.title}
      error={error}
      pending={pending}
      yesLabel={labels.yesLabel}
      noLabel={labels.noLabel}
      pendingLabel={texts.deletingLabel}
      onConfirm={onConfirm}
      onCancel={onCancel}
    />
  );
}
