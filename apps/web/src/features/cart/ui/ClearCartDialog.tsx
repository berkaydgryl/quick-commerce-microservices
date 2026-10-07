import { ConfirmDialog } from '../../../shared/ui/confirm-panel/ConfirmDialog';
import { useConfirmContent } from '../../content/hooks/useConfirmContent';

interface ClearCartDialogProps {
  /** "Sepeti boşaltmak istediğinden emin misin?" (marketList.cart.clearConfirmQuestion). */
  readonly question: string;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
}

/**
 * Sepeti bosaltma onayi (T16.3; F13 ortak onay penceresi): panelin cop kutusu
 * ("Sepeti boşalt") ve /sepet "Sepeti temizle" ayni soruyu sorar; "Hayır" ve
 * "Evet". Etiketler icerikten (useConfirmContent); baska durum tutmaz.
 */
export function ClearCartDialog({ question, onConfirm, onCancel }: ClearCartDialogProps) {
  const labels = useConfirmContent();
  return (
    <ConfirmDialog
      question={question}
      error={null}
      pending={false}
      yesLabel={labels.yesLabel}
      noLabel={labels.noLabel}
      onConfirm={onConfirm}
      onCancel={onCancel}
    />
  );
}
