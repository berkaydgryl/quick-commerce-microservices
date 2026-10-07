import type { MarketListCartContent } from '@getir/contracts';
import { CURRENCY } from '@getir/core';
import { Link } from 'react-router-dom';

import { formatMoney } from '../../../shared/services/format';
import { useCartMarketClosed } from '../hooks/useCartMarketClosed';
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
 * bosluk listenin son kartinin cubugun altinda kalmasini onler. Sepetin
 * marketi kapaliysa (07.10) solda "Market şu an kapalı" (panelin notunun
 * yerine); "Sepete git" aktif kalir (/sepet durdurur).
 */
export function CartBar({ texts, cartHref }: CartBarProps) {
  const market = useCartStore((cart) => cart.market);
  const count = useCartStore(itemCount);
  const totals = useCartTotals();
  const closed = useCartMarketClosed();

  if (market === null || count === 0) {
    return null;
  }
  return (
    <CartBarView
      texts={texts}
      href={cartHref(market.id)}
      count={count}
      totalMinor={totals?.totalMinor}
      closed={closed}
    />
  );
}

interface CartBarViewProps {
  readonly texts: MarketListCartContent;
  readonly href: string;
  readonly count: number;
  /** Kurallar gelene kadar undefined: tutar yazilmaz. */
  readonly totalMinor: number | undefined;
  readonly closed: boolean;
}

/** Cubugun gorunumu (durumsuz): solda "Sepetim · N ürün" ya da kapaliysa sebep. */
export function CartBarView({ texts, href, count, totalMinor, closed }: CartBarViewProps) {
  return (
    <>
      <div className={styles['c-cart-bar__spacer']} aria-hidden="true" />
      <div className={styles['c-cart-bar']}>
        <Link to={href} className={styles['c-cart-bar__link']}>
          <span>
            {closed ? texts.closedNotice : `${texts.title} · ${count} ${texts.itemCountLabel}`}
          </span>
          <span className={styles['c-cart-bar__go']}>
            {totalMinor !== undefined && (
              <span>{formatMoney({ amountMinor: totalMinor, currency: CURRENCY })} ·</span>
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
