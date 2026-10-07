import { CURRENCY } from '@getir/core';
import type { ReactNode } from 'react';

import { formatMoney } from '../../../shared/services/format';
import { LowStockBadge } from '../../../shared/ui/low-stock-badge/LowStockBadge';
import type { CartItem } from '../services/cart-state';
import { lineTotalMinor } from '../services/cart-state';

import styles from './CartItemsCard.module.css';
import { CartQuantityStepper } from './CartQuantityStepper';
import type { CartStepperTexts } from './CartQuantityStepper';

export type CartPageItemTexts = CartStepperTexts & {
  readonly lowStockPrefix: string;
  readonly lowStockSuffix: string;
};

interface CartPageItemProps {
  readonly item: CartItem;
  /** Satirin gorseli (kategorinin; sayfa verir: sepet katalogu tanimaz). */
  readonly visual: ReactNode;
  readonly texts: CartPageItemTexts;
  readonly canIncrement: boolean;
  readonly onIncrement: () => void;
  readonly onDecrement: () => void;
}

/**
 * Sepet sayfasinin satiri (T16.3; referans getircarsi): gorsel, ad, mor kalem
 * tutari, stok azsa "Son N adet"; sagda sepet panelinin adet kutusu (adet 1'de
 * "−" yerine cop kutusu). Satir sonunda ayri cop kutusu YOK (referans, PM
 * karari L3). Rozetin sayisi kalemin stok siniridir (eklendigi andaki stok).
 */
export function CartPageItem({
  item,
  visual,
  texts,
  canIncrement,
  onIncrement,
  onDecrement,
}: CartPageItemProps) {
  return (
    <li className={styles['c-cart-items__item']}>
      <span className={styles['c-cart-items__visual']}>{visual}</span>
      <span className={styles['c-cart-items__item-text']}>
        <span className={styles['c-cart-items__item-name']}>{item.name}</span>
        <span className={styles['c-cart-items__item-price']}>
          {formatMoney({ amountMinor: lineTotalMinor(item), currency: CURRENCY })}
        </span>
        <LowStockBadge stock={item.maxQuantity} texts={texts} />
      </span>
      <CartQuantityStepper
        name={item.name}
        quantity={item.quantity}
        canIncrement={canIncrement}
        texts={texts}
        onIncrement={onIncrement}
        onDecrement={onDecrement}
      />
    </li>
  );
}
