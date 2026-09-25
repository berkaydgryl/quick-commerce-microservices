import { formatMoney } from '../../../shared/services/format';
import { useCartTotals } from '../hooks/useCartTotals';
import { itemCount } from '../services/cart-state';
import { useCartStore } from '../stores/useCartStore';

import styles from './Cart.module.css';

const TRY = 'TRY';
const money = (amountMinor: number) => formatMoney({ amountMinor, currency: TRY });

/**
 * Sepet ozeti - TASARIMSIZ KABUK (T6.4). Hesap @getir/pricing'tedir; bilesen
 * yalnizca sonucu yazar. Sepet bossa hic cizilmez.
 */
export function CartSummary() {
  const market = useCartStore((cart) => cart.market);
  const count = useCartStore(itemCount);
  const clear = useCartStore((cart) => cart.clear);
  const totals = useCartTotals();

  if (market === null || count === 0) {
    return null;
  }

  return (
    <section
      className={styles['c-cart-summary']}
      aria-labelledby="sepet-baslik"
      aria-busy={totals === undefined}
    >
      <h2 id="sepet-baslik" className={styles['c-cart-summary__title']}>
        Sepet · {market.name} · {count} ürün
      </h2>

      {totals !== undefined && (
        <dl className={styles['c-cart-summary__lines']}>
          <dt>Ara toplam</dt>
          <dd>{money(totals.subtotalMinor)}</dd>
          <dt>Teslimat</dt>
          <dd>{totals.deliveryFeeMinor === 0 ? 'Ücretsiz' : money(totals.deliveryFeeMinor)}</dd>
          <dt className={styles['c-cart-summary__total']}>Toplam</dt>
          <dd className={styles['c-cart-summary__total']}>{money(totals.totalMinor)}</dd>
        </dl>
      )}

      {totals !== undefined && !totals.canCheckout && (
        <p className={styles['c-cart-summary__notice']}>
          Minimum sepet tutarına {money(totals.amountToMinBasketMinor)} kaldı.
        </p>
      )}
      {totals !== undefined && totals.amountToFreeDeliveryMinor > 0 && (
        <p className={styles['c-cart-summary__hint']}>
          Ücretsiz teslimata {money(totals.amountToFreeDeliveryMinor)} kaldı.
        </p>
      )}

      <button type="button" className={styles['c-cart-summary__clear']} onClick={clear}>
        Sepeti boşalt
      </button>
    </section>
  );
}
