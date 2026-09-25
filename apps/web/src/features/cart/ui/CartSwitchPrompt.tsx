import type { PendingSwitch } from '../hooks/useAddToCart';

import styles from './Cart.module.css';

interface CartSwitchPromptProps {
  readonly pending: PendingSwitch;
  readonly targetMarketName: string;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
}

/**
 * Baska marketten ekleme onayi - TASARIMSIZ KABUK (T6.4). "ile" kullanildi:
 * "-den/-dan/-ndan" eki market adina gore degisir ("Besiktas'tan",
 * "Manavi'ndan") ve her ad icin dogru uretmek kirilgan olurdu.
 */
export function CartSwitchPrompt({
  pending,
  targetMarketName,
  onConfirm,
  onCancel,
}: CartSwitchPromptProps) {
  return (
    <div
      className={styles['c-cart-switch']}
      role="alertdialog"
      aria-labelledby="sepet-degisim-metni"
    >
      <p id="sepet-degisim-metni">
        Sepetinde {pending.currentMarket.name} ürünleri var. Sepeti boşaltıp {targetMarketName} ile
        devam edilsin mi?
      </p>
      <div className={styles['c-cart-switch__actions']}>
        <button type="button" className={styles['c-cart-switch__confirm']} onClick={onConfirm}>
          Evet
        </button>
        <button type="button" className={styles['c-cart-switch__cancel']} onClick={onCancel}>
          Vazgeç
        </button>
      </div>
    </div>
  );
}
