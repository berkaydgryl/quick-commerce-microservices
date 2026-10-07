import type { MarketPageContent, Product } from '@getir/contracts';

import { canAdd, isSoldOut, quantityOf } from '../services/cart-state';
import { useCartStore } from '../stores/useCartStore';

import { CartQuantityStepper } from './CartQuantityStepper';
import type { CartStepperOrientation, CartStepperTexts } from './CartQuantityStepper';
import styles from './ProductCartAction.module.css';

/** Adet kutusunun metinleri (marketList.cart) ve kartin kendi metinleri (marketPage). */
export type ProductCartTexts = CartStepperTexts &
  Pick<MarketPageContent, 'addSuffix' | 'soldOutLabel' | 'unavailableLabel'>;

interface ProductCartActionProps {
  readonly product: Product;
  readonly onAdd: (product: Product) => void;
  readonly texts: ProductCartTexts;
  /** Magaza sayfasinin karti dikey, ana sayfa aramasinin satiri yatay (T9.6: ayni bilesen). */
  readonly orientation?: CartStepperOrientation | undefined;
}

/**
 * Urunun sepet dugmesi (T6.4; T16.2'de referans getircarsi): sepet deposunu
 * okur, gorunumu besler. "Eklenebilir mi" ve "tukendi mi" kararlarini bilesen
 * VERMEZ, cart-state'e sorar (D11): stok ve satis kurallari tek yerde.
 */
export function ProductCartAction({ product, onAdd, texts, orientation }: ProductCartActionProps) {
  const quantity = useCartStore((cart) => quantityOf(cart, product.offerId));
  const addable = useCartStore((cart) => canAdd(cart, product));
  const decrement = useCartStore((cart) => cart.decrement);

  return (
    <ProductCartActionView
      product={product}
      quantity={quantity}
      addable={addable}
      soldOut={isSoldOut(product)}
      texts={texts}
      orientation={orientation}
      onAdd={() => onAdd(product)}
      onDecrement={() => decrement(product.offerId)}
    />
  );
}

interface ProductCartActionViewProps {
  readonly product: Product;
  /** Sepetteki adet; 0: sepette yok. */
  readonly quantity: number;
  /** cart-state canAdd: "+" acik mi. */
  readonly addable: boolean;
  /** cart-state isSoldOut. */
  readonly soldOut: boolean;
  readonly texts: ProductCartTexts;
  readonly orientation?: CartStepperOrientation | undefined;
  readonly onAdd: () => void;
  readonly onDecrement: () => void;
}

/**
 * Dugmenin gorunumu: sepette yoksa "+", varsa sepet panelinin adet kutusu
 * (adet 1'de "−" yerine cop kutusu). Satista olmayan teklifte "Satışta değil"
 * (T7.6), stogu bitende "Tükendi" (T8.4); ikisi de dugme degil. Durumsuz.
 */
export function ProductCartActionView({
  product,
  quantity,
  addable,
  soldOut,
  texts,
  orientation,
  onAdd,
  onDecrement,
}: ProductCartActionViewProps) {
  // Sepette zaten varsa (satistan sonra kaldirildiysa ya da stok sonradan
  // bittiyse) adet kutusu kalir: kullanici azaltip cikarabilsin; "+" canAdd
  // geregi kapali. Rezervasyonun cevabi T11.5'te gosterilir.
  if (quantity === 0 && (!product.isActive || soldOut)) {
    return (
      <span className={styles['c-product-cart-action__unavailable']}>
        {product.isActive ? texts.soldOutLabel : texts.unavailableLabel}
      </span>
    );
  }

  if (quantity === 0) {
    return (
      <button
        type="button"
        className={styles['c-product-cart-action__add']}
        aria-label={`${product.name} ${texts.addSuffix}`}
        disabled={!addable}
        onClick={onAdd}
      >
        <span aria-hidden="true">+</span>
      </button>
    );
  }

  return (
    <CartQuantityStepper
      name={product.name}
      quantity={quantity}
      canIncrement={addable}
      texts={texts}
      orientation={orientation}
      onIncrement={onAdd}
      onDecrement={onDecrement}
    />
  );
}
