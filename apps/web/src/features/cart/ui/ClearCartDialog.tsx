import type { MarketListCartContent } from '@getir/contracts';

import { ConfirmPanel } from '../../../shared/ui/confirm-panel/ConfirmPanel';
import { Dialog } from '../../../shared/ui/dialog/Dialog';

interface ClearCartDialogProps {
  readonly texts: MarketListCartContent;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
}

/**
 * Sepeti bosaltma onayi (T16.3; referans getircarsi): ortak pencere kabugu
 * (odak pencerede, Esc kapatir) ve ortak onay govdesi: "Sepeti boşaltmak
 * istediğine emin misin?", altinda not, "Vazgeç" ve "Boşalt". Durumsuz.
 */
export function ClearCartDialog({ texts, onConfirm, onCancel }: ClearCartDialogProps) {
  return (
    <Dialog title={texts.clearLabel} close={{ label: texts.closeLabel, onAction: onCancel }}>
      <ConfirmPanel
        questionSuffix={texts.clearConfirmQuestion}
        hint={texts.clearConfirmHint}
        error={null}
        pending={false}
        confirmLabel={texts.clearConfirmLabel}
        pendingLabel={texts.clearConfirmLabel}
        cancelLabel={texts.cancelLabel}
        onConfirm={onConfirm}
        onCancel={onCancel}
      />
    </Dialog>
  );
}
