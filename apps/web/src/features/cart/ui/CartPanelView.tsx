import type { MarketListCartContent } from '@getir/contracts';
import { CURRENCY } from '@getir/core';
import type { CartTotals } from '@getir/pricing';
import { useId } from 'react';
import { Link } from 'react-router-dom';

import { formatMoney } from '../../../shared/services/format';
import type { CartItem, CartMarket } from '../services/cart-state';
import { lineTotalMinor } from '../services/cart-state';

import styles from './CartPanel.module.css';
import { BagIcon } from './icons';

const money = (amountMinor: number) => formatMoney({ amountMinor, currency: CURRENCY });

export interface CartPanelViewProps {
  readonly texts: MarketListCartContent;
  readonly market: CartMarket | null;
  readonly items: readonly CartItem[];
  /** Sepetin marketinin kurallariyla toplam; kurallar gelene kadar undefined. */
  readonly totals: CartTotals | undefined;
  /** "Sepete git": sepetin marketinin sayfasi. */
  readonly cartHref: string | undefined;
  readonly onClear: () => void;
}

/**
 * Sepetim paneli (T11.12; referans getircarsi): baslik kartin ustunde. Bossa
 * canta ikonu ve "Sepetin şu an boş"; doluysa sepetin marketi, kalemler,
 * toplamlar, minimum sepete kalan ve "Sepete git". Hesap @getir/pricing'tedir
 * (useCartTotals); bilesen yalnizca sonucu yazar.
 */
export function CartPanelView({
  texts,
  market,
  items,
  totals,
  cartHref,
  onClear,
}: CartPanelViewProps) {
  const titleId = useId();
  const empty = market === null || items.length === 0;

  return (
    <section className={styles['c-cart-panel']} aria-labelledby={titleId}>
      <h2 id={titleId} className={styles['c-cart-panel__title']}>
        {texts.title}
      </h2>
      <div className={styles['c-cart-panel__card']}>
        {empty ? (
          <div className={styles['c-cart-panel__empty']}>
            <span className={styles['c-cart-panel__empty-icon']}>
              <BagIcon />
            </span>
            <div>
              <p className={styles['c-cart-panel__empty-title']}>{texts.emptyTitle}</p>
              <p className={styles['c-cart-panel__empty-hint']}>{texts.emptyHint}</p>
            </div>
          </div>
        ) : (
          <>
            <p className={styles['c-cart-panel__market']}>{market.name}</p>
            <ul className={styles['c-cart-panel__items']} role="list">
              {items.map((item) => (
                <li key={item.productId} className={styles['c-cart-panel__item']}>
                  <span>
                    {item.name} × {item.quantity}
                  </span>
                  <span>{money(lineTotalMinor(item))}</span>
                </li>
              ))}
            </ul>
            {totals !== undefined && (
              <dl className={styles['c-cart-panel__lines']}>
                <dt>{texts.subtotalLabel}</dt>
                <dd>{money(totals.subtotalMinor)}</dd>
                <dt>{texts.deliveryLabel}</dt>
                <dd>
                  {totals.deliveryFeeMinor === 0
                    ? texts.freeDeliveryLabel
                    : money(totals.deliveryFeeMinor)}
                </dd>
                <dt className={styles['c-cart-panel__total']}>{texts.totalLabel}</dt>
                <dd className={styles['c-cart-panel__total']}>{money(totals.totalMinor)}</dd>
              </dl>
            )}
            {totals !== undefined && !totals.canCheckout && (
              <p className={styles['c-cart-panel__notice']}>
                {texts.minBasketRemainingLabel}: {money(totals.amountToMinBasketMinor)}
              </p>
            )}
            <div className={styles['c-cart-panel__actions']}>
              {cartHref !== undefined && (
                <Link to={cartHref} className={styles['c-cart-panel__go']}>
                  {texts.goToCartLabel}
                </Link>
              )}
              <button type="button" className={styles['c-cart-panel__clear']} onClick={onClear}>
                {texts.clearLabel}
              </button>
            </div>
          </>
        )}
      </div>
    </section>
  );
}
