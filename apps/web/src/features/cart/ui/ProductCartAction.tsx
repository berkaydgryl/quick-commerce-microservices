import type { Product } from '@getir/contracts';

import { canAdd, quantityOf } from '../services/cart-state';
import { useCartStore } from '../stores/useCartStore';

import styles from './Cart.module.css';

interface ProductCartActionProps {
  readonly product: Product;
  readonly onAdd: (product: Product) => void;
}

/**
 * Urunun sepet dugmesi - TASARIMSIZ KABUK (T6.4). Sepette yoksa "Ekle", varsa
 * "- adet +"; satista olmayan teklifte basilamayan "Satista degil" (T7.6).
 * "Eklenebilir mi" kararini bilesen VERMEZ, canAdd'e sorar (D11): stok ve
 * satis kurallari tek yerde. Tasarim degisince bilesen yeniden yazilabilir.
 */
export function ProductCartAction({ product, onAdd }: ProductCartActionProps) {
  const quantity = useCartStore((cart) => quantityOf(cart, product.offerId));
  const addable = useCartStore((cart) => canAdd(cart, product));
  const decrement = useCartStore((cart) => cart.decrement);

  // Sepette zaten varsa (satistan sonra kaldirildiysa) adet dugmeleri kalir:
  // kullanici azaltip cikarabilsin; "+" canAdd geregi kapali.
  if (quantity === 0 && !product.isActive) {
    return <span className={styles['c-cart-action__unavailable']}>Satışta değil</span>;
  }

  if (quantity === 0) {
    return (
      <button
        type="button"
        className={styles['c-cart-action__add']}
        aria-label={`${product.name} sepete ekle`}
        disabled={!addable}
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
        disabled={!addable}
        onClick={() => onAdd(product)}
      >
        +
      </button>
    </div>
  );
}
