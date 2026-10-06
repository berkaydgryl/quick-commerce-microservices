import type { PaymentMethodsContent, SavedCard } from '@getir/contracts';

import { ConfirmPanel } from '../../../shared/ui/confirm-panel/ConfirmPanel';
import { Dialog } from '../../../shared/ui/dialog/Dialog';
import { cardShortName, cardSpokenName } from '../services/card-face';

interface DeleteCardDialogProps {
  readonly texts: PaymentMethodsContent;
  /** Kapat (X) dugmesinin erisilebilir adi (icerikten). */
  readonly closeLabel: string;
  readonly card: SavedCard;
  readonly pending: boolean;
  /** Sunucunun cumlesi (ag, 404); yoksa null. */
  readonly error: string | null;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
}

/**
 * Kart silme onayi (T11.17, M6): "Visa •••• 4242 kartını silmek istiyor
 * musun?" (ekran okuyucu "Visa, son dört hane 4242" duyar, QA K4), altinda
 * siparislerin etkilenmedigi; "Vazgeç" ve "Sil". Kabuk adres
 * pencerelerinin (profil penceresi gibi), govde ortak ConfirmPanel. Durumsuz.
 */
export function DeleteCardDialog({
  texts,
  closeLabel,
  card,
  pending,
  error,
  onConfirm,
  onCancel,
}: DeleteCardDialogProps) {
  return (
    <Dialog
      title={texts.confirmTitle}
      close={{ label: closeLabel, onAction: onCancel, disabled: pending }}
    >
      <ConfirmPanel
        subject={cardShortName(card, texts.brandLabels)}
        spokenSubject={cardSpokenName(card, texts.brandLabels, texts.lastFourLabel)}
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
    </Dialog>
  );
}
