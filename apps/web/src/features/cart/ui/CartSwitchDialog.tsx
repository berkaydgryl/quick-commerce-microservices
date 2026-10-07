import type { MarketListCartContent } from '@getir/contracts';
import { useEffect, useState } from 'react';

import { ConfirmDialog } from '../../../shared/ui/confirm-panel/ConfirmDialog';
import { useConfirmContent } from '../../content/hooks/useConfirmContent';
import type { PendingSwitch } from '../hooks/useAddToCart';

import { captureSwitchFocus } from './switch-focus';

export type CartSwitchTexts = Pick<
  MarketListCartContent,
  'switchConfirmPrefix' | 'switchConfirmSuffix' | 'increaseSuffix'
>;

interface CartSwitchDialogProps {
  readonly pending: PendingSwitch;
  /** Eklenen urunun marketi: soruda adi gecer (aramada hangi market belli olsun). */
  readonly targetMarketName: string;
  readonly texts: CartSwitchTexts;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
}

/**
 * Baska marketten ekleme onayi (T6.4; T16.3'te ekranin ortasinda pencere; F13
 * ortak onay penceresi): sepet bosaltilacagi icin silme onayiyla ayni pencere;
 * soru icerikten, hedef marketin adiyla ("…Sepeti boşaltıp A101 – Caferağa ile
 * devam etmek istediğinden emin misin?"; eskiden kodda sabitti; "ile" ek uyumu
 * gerektirmez). "Evet" sepeti bosaltip bekleyen urunu ekler; "Hayır", Esc ve
 * karartma hicbir seyi degistirmez. Odak acilista "Hayır"da; kapaninca tiklanan
 * "+"ya, "+" adet kutusuna donustuyse kutunun "adedini artır"ina doner
 * (switch-focus.ts). Mağaza sayfasi ve arama sonuclari bu bileseni kullanir.
 */
export function CartSwitchDialog({
  pending,
  targetMarketName,
  texts,
  onConfirm,
  onCancel,
}: CartSwitchDialogProps) {
  const labels = useConfirmContent();
  const [returnFocus] = useState(() =>
    captureSwitchFocus(`${pending.product.name} ${texts.increaseSuffix}`),
  );
  useEffect(() => returnFocus, [returnFocus]);

  return (
    <ConfirmDialog
      question={`${texts.switchConfirmPrefix} ${targetMarketName} ${texts.switchConfirmSuffix}`}
      error={null}
      pending={false}
      yesLabel={labels.yesLabel}
      noLabel={labels.noLabel}
      onConfirm={onConfirm}
      onCancel={onCancel}
    />
  );
}
