import type { MarketListCartContent } from '@getir/contracts';
import { CURRENCY } from '@getir/core';
import { Link } from 'react-router-dom';

import { formatMoney } from '../../../shared/services/format';
import { useCartTotals } from '../hooks/useCartTotals';
import { itemCount } from '../services/cart-state';
import { useCartStore } from '../stores/useCartStore';

import styles from './CartBar.module.css';
import { ChevronRightIcon } from './icons';

interface CartBarProps {
  readonly texts: MarketListCartContent;
  readonly cartHref: (marketId: string) => string;
}

/**
 * Telefon ve tablette Sepetim'in yerine (T11.12): ekranin altinda sabit cubuk
 * ("Sepetim · 3 ürün" | toplam · "Sepete git"). Yalnizca sepet doluyken
 * gorunur; genis ekranda gizlidir (sag sutundaki panel vardir). Onundeki
 * bosluk listenin son kartinin cubugun altinda kalmasini onler.
 */
export function CartBar({ texts, cartHref }: CartBarProps) {
  const market = useCartStore((cart) => cart.market);
  const count = useCartStore(itemCount);
  const totals = useCartTotals();

  if (market === null || count === 0) {
    return null;
  }
  return (
    <>
      <div className={styles['c-cart-bar__spacer']} aria-hidden="true" />
      <div className={styles['c-cart-bar']}>
        <Link to={cartHref(market.id)} className={styles['c-cart-bar__link']}>
          <span>
            {texts.title} · {count} {texts.itemCountLabel}
          </span>
          <span className={styles['c-cart-bar__go']}>
            {totals !== undefined && (
              <span>{formatMoney({ amountMinor: totals.totalMinor, currency: CURRENCY })} ·</span>
            )}
            {texts.goToCartLabel}
            <span className={styles['c-cart-bar__icon']}>
              <ChevronRightIcon />
            </span>
          </span>
        </Link>
      </div>
    </>
  );
}
