import { CURRENCY } from '@getir/core';

import { formatMoney } from '../../../shared/services/format';
import { TrashIcon } from '../../address/ui/icons';
import type { CartItem } from '../services/cart-state';
import { lineTotalMinor } from '../services/cart-state';

import styles from './CartPanel.module.css';
import { CartQuantityStepper } from './CartQuantityStepper';
import type { CartStepperTexts } from './CartQuantityStepper';

interface CartPanelItemProps {
  readonly item: CartItem;
  readonly texts: CartStepperTexts;
  readonly canIncrement: boolean;
  readonly onIncrement: () => void;
  readonly onDecrement: () => void;
  readonly onRemove: () => void;
}

/**
 * Sepet panelinin bir satiri (T16.3; referans getircarsi): solda urun adi ve
 * altinda mor kalem tutari, sagda adet kutusu. Adet 2 ve ustundeyse satirin
 * sonunda ayrica cop kutusu (kalemi tumden siler); adet 1'de kutunun "−"si
 * zaten cop kutusudur, satir sonundaki GIZLENIR: tek silme dugmesi kalir.
 * Dar panelde (1280'de sutun dar) dugmeler adin altina iner; ad kelime
 * ortasindan kirilmaz.
 */
export function CartPanelItem({
  item,
  texts,
  canIncrement,
  onIncrement,
  onDecrement,
  onRemove,
}: CartPanelItemProps) {
  return (
    <li className={styles['c-cart-panel__item']}>
      <span className={styles['c-cart-panel__item-text']}>
        <span className={styles['c-cart-panel__item-name']}>{item.name}</span>
        <span className={styles['c-cart-panel__item-price']}>
          {formatMoney({ amountMinor: lineTotalMinor(item), currency: CURRENCY })}
        </span>
      </span>
      <span className={styles['c-cart-panel__item-controls']}>
        <CartQuantityStepper
          name={item.name}
          quantity={item.quantity}
          canIncrement={canIncrement}
          texts={texts}
          onIncrement={onIncrement}
          onDecrement={onDecrement}
        />
        {item.quantity >= 2 && (
          <button
            type="button"
            className={styles['c-cart-panel__item-remove']}
            aria-label={`${item.name} ${texts.removeSuffix}`}
            onClick={onRemove}
          >
            <TrashIcon />
          </button>
        )}
      </span>
    </li>
  );
}
