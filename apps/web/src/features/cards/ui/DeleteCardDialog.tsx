import type { PaymentMethodsContent, SavedCard } from '@getir/contracts';

import { ConfirmDialog } from '../../../shared/ui/confirm-panel/ConfirmDialog';
import { useConfirmContent } from '../../content/hooks/useConfirmContent';
import { cardSpokenName } from '../services/card-face';

interface DeleteCardDialogProps {
  readonly texts: Pick<
    PaymentMethodsContent,
    'confirmQuestion' | 'deletingLabel' | 'brandLabels' | 'lastFourLabel'
  >;
  readonly card: SavedCard;
  readonly pending: boolean;
  /** Sunucunun cumlesi (ag, 404); yoksa null. */
  readonly error: string | null;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
}

/**
 * Kart silme onayi (T11.17, M6; F13 ortak onay penceresi): "Kartı silmek
 * istediğinden emin misin?", "Hayır" ve "Evet" (beklerken "Siliniyor…").
 * Gorunen soru duz (PM S1 (a)); ekran okuyucu arkasinda hangi kart oldugunu
 * duyar ("Visa, son dört hane 4242"; QA K4). Ödeme Yöntemlerim ve odeme
 * sayfasinin penceresi ayni bileseni kullanir. Etiketler icerikten (kanca).
 */
export function DeleteCardDialog({
  texts,
  card,
  pending,
  error,
  onConfirm,
  onCancel,
}: DeleteCardDialogProps) {
  const labels = useConfirmContent();
  return (
    <ConfirmDialog
      question={texts.confirmQuestion}
      spokenDetail={cardSpokenName(card, texts.brandLabels, texts.lastFourLabel)}
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
