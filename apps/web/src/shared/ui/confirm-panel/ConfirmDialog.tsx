import { useId } from 'react';

import { Dialog } from '../dialog/Dialog';

import { ConfirmPanel } from './ConfirmPanel';
import type { ConfirmPanelProps } from './ConfirmPanel';

type ConfirmDialogProps = Omit<ConfirmPanelProps, 'questionId'>;

/**
 * Ortak onay penceresi (F13; 07.10 kullanici istegi): BUTUN silme onaylari bu
 * pencereyi kullanir (sepeti bosalt/temizle, karti sil, adresi sil, market
 * degistirme). Koyu ortu, ortada beyaz kutu, tek soru, "Hayır" ve "Evet".
 * "Hayır", Esc ve ortuye tiklama iptal; islem surerken uc yol da kapali.
 * Odak acilista "Hayır"da, kapaninca acan dugmede (tarayicinin <dialog>'u).
 * Pencerenin adi sorudur (ve varsa ekran okuyucu ayrintisi).
 */
export function ConfirmDialog(panel: ConfirmDialogProps) {
  const questionId = useId();
  return (
    <Dialog
      variant="confirm"
      title={panel.question}
      labelledBy={questionId}
      close={{ label: panel.noLabel, onAction: panel.onCancel, disabled: panel.pending }}
    >
      <ConfirmPanel questionId={questionId} {...panel} />
    </Dialog>
  );
}
