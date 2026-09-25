import { CART_ITEM_MAX_QUANTITY } from '@getir/contracts';
import type { Product } from '@getir/contracts';

import { quantityOf } from '../services/cart-state';
import { useCartStore } from '../stores/useCartStore';

import styles from './Cart.module.css';

interface ProductCartActionProps {
  readonly product: Product;
  readonly onAdd: (product: Product) => void;
}

/**
 * Urunun sepet dugmesi - TASARIMSIZ KABUK (T6.4). Sepette yoksa "Ekle", varsa
 * "- adet +". Karar store'da; bu bilesen yalnizca cizer ve cagirir, tasarim
 * degisince tamamen yeniden yazilabilir.
 */
export function ProductCartAction({ product, onAdd }: ProductCartActionProps) {
  const quantity = useCartStore((cart) => quantityOf(cart, product.offerId));
  const decrement = useCartStore((cart) => cart.decrement);

  if (quantity === 0) {
    return (
      <button
        type="button"
        className={styles['c-cart-action__add']}
        aria-label={`${product.name} sepete ekle`}
        onClick={() => onAdd(product)}
      >
        Ekle
      </button>
    );
  }

  return (
    <div className={styles['c-cart-action']} role="group" aria-label={`${product.name} adedi`}>
      <button
        type="button"
        className={styles['c-cart-action__step']}
        aria-label={`${product.name} bir azalt`}
        onClick={() => decrement(product.offerId)}
      >
        −
      </button>
      <span className={styles['c-cart-action__quantity']} aria-live="polite">
        {quantity}
      </span>
      <button
        type="button"
        className={styles['c-cart-action__step']}
        aria-label={`${product.name} bir artir`}
        disabled={quantity >= CART_ITEM_MAX_QUANTITY}
        onClick={() => onAdd(product)}
      >
        +
      </button>
    </div>
  );
}
