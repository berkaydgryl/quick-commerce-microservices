import type { MarketListCartContent } from '@getir/contracts';
import { useEffect, useState } from 'react';

import { ConfirmPanel } from '../../../shared/ui/confirm-panel/ConfirmPanel';
import { Dialog } from '../../../shared/ui/dialog/Dialog';
import type { PendingSwitch } from '../hooks/useAddToCart';

import { captureSwitchFocus } from './switch-focus';

export type CartSwitchTexts = Pick<
  MarketListCartContent,
  'clearLabel' | 'cancelLabel' | 'closeLabel' | 'increaseSuffix'
>;

interface CartSwitchDialogProps {
  readonly pending: PendingSwitch;
  readonly targetMarketName: string;
  readonly texts: CartSwitchTexts;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
}

/**
 * Baska marketten ekleme onayi (T6.4; T16.3 duzeltmesi: kullanici istegiyle
 * satir ici kutu yerine ekranin ORTASINDA pencere). "Sepeti boşalt"
 * penceresinin kabugu ve govdesi (ortak Dialog + ConfirmPanel): arka plan
 * karartilir, odak pencerede, Esc ve X "Vazgeç" ile ayni yol. Soru ve
 * dugmeler T6.4'tekiyle ayni: mor "Evet" sepeti bosaltip bekleyen urunu
 * ekler, "Vazgeç" hicbir seyi degistirmez. Acilinca odak "Vazgeç"te; kapaninca
 * tiklanan "+"ya doner (switch-focus.ts). Mağaza sayfasi ve arama sonuclari
 * bu bileseni kullanir.
 *
 * "ile" kullanildi: "-den/-dan/-ndan" eki market adina gore degisir
 * ("Besiktas'tan", "Manavi'ndan") ve her ad icin dogru uretmek kirilgan olurdu.
 */
export function CartSwitchDialog({
  pending,
  targetMarketName,
  texts,
  onConfirm,
  onCancel,
}: CartSwitchDialogProps) {
  const [returnFocus] = useState(() =>
    captureSwitchFocus(`${pending.product.name} ${texts.increaseSuffix}`),
  );
  useEffect(() => returnFocus, [returnFocus]);

  return (
    <Dialog title={texts.clearLabel} close={{ label: texts.closeLabel, onAction: onCancel }}>
      <ConfirmPanel
        questionSuffix={`Sepetinde ${pending.currentMarket.name} ürünleri var. Sepeti boşaltıp ${targetMarketName} ile devam edilsin mi?`}
        error={null}
        pending={false}
        confirmLabel="Evet"
        confirmTone="primary"
        pendingLabel="Evet"
        cancelLabel={texts.cancelLabel}
        focusCancel
        onConfirm={onConfirm}
        onCancel={onCancel}
      />
    </Dialog>
  );
}
