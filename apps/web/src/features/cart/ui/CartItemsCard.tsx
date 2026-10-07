import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

import type { CartItem, CartMarket } from '../services/cart-state';

import styles from './CartItemsCard.module.css';
import { CartPageItem } from './CartPageItem';
import type { CartPageItemTexts } from './CartPageItem';
import { StoreIcon } from './icons';

interface CartItemsCardProps {
  readonly market: CartMarket;
  readonly items: readonly CartItem[];
  /** Magaza adinin baglantisi: sepetin marketinin sayfasi. */
  readonly marketHref: string;
  readonly texts: CartPageItemTexts;
  readonly renderVisual: (item: CartItem) => ReactNode;
  readonly canIncrement: (offerId: string) => boolean;
  readonly onIncrement: (offerId: string) => void;
  readonly onDecrement: (offerId: string) => void;
}

/**
 * Sepet sayfasinin beyaz kutusu (T16.3; referans getircarsi): ustte magaza
 * ikonu ve adi (magazaya gider), altta satirlar. Durumsuz.
 */
export function CartItemsCard({
  market,
  items,
  marketHref,
  texts,
  renderVisual,
  canIncrement,
  onIncrement,
  onDecrement,
}: CartItemsCardProps) {
  return (
    <div className={styles['c-cart-items__card']}>
      <div className={styles['c-cart-items__store']}>
        <span className={styles['c-cart-items__store-icon']} aria-hidden="true">
          <StoreIcon />
        </span>
        <Link to={marketHref} className={styles['c-cart-items__store-name']}>
          {market.name}
        </Link>
      </div>
      <ul className={styles['c-cart-items__items']} role="list">
        {items.map((item) => (
          <CartPageItem
            key={item.offerId}
            item={item}
            visual={renderVisual(item)}
            texts={texts}
            canIncrement={canIncrement(item.offerId)}
            onIncrement={() => onIncrement(item.offerId)}
            onDecrement={() => onDecrement(item.offerId)}
          />
        ))}
      </ul>
    </div>
  );
}
