import type { CartPageContent, MarketListCartContent } from '@getir/contracts';
import { CURRENCY } from '@getir/core';
import type { CartTotals } from '@getir/pricing';
import { useId } from 'react';
import { Link } from 'react-router-dom';

import { formatMoney } from '../../../shared/services/format';

import styles from './CartTotalsCard.module.css';

const money = (amountMinor: number) => formatMoney({ amountMinor, currency: CURRENCY });

interface CartTotalsCardProps {
  readonly totals: CartTotals | undefined;
  readonly texts: Pick<
    CartPageContent,
    'totalsTitle' | 'subtotalLabel' | 'freeDeliveryRemainingLabel' | 'checkoutLabel'
  >;
  /** "Minimum sepet tutarına kalan" (sepet paneliyle ayni metin). */
  readonly cartTexts: Pick<MarketListCartContent, 'minBasketRemainingLabel'>;
  /** Odeme sayfasi (T17.1); sayfa verir: sepet odeme sayfasini tanimaz. */
  readonly checkoutHref: string;
}

/**
 * "Sepet Toplamı" (T16.3; referans getircarsi): "Sepet Tutarı" ve mor tutar;
 * altinda minimum sepete ve ucretsiz teslimata kalan (T16.3 olcutu), sonra mor
 * "Ödemeye Geç": odeme sayfasina (T17.1) baglanti. Minimum sepet tutmazsa ya
 * da kurallar gelmediyse PASIF (aria-disabled): odeme sayfasinda da siparis
 * verilemezdi. Hesap @getir/pricing'te; durumsuz.
 */
export function CartTotalsCard({ totals, texts, cartTexts, checkoutHref }: CartTotalsCardProps) {
  const titleId = useId();
  return (
    <section className={styles['c-cart-totals']} aria-labelledby={titleId}>
      <h2 id={titleId} className={styles['c-cart-totals__title']}>
        {texts.totalsTitle}
      </h2>
      <div className={styles['c-cart-totals__card']}>
        <p className={styles['c-cart-totals__row']}>
          <span>{texts.subtotalLabel}</span>
          {totals !== undefined && (
            <span className={styles['c-cart-totals__amount']}>{money(totals.subtotalMinor)}</span>
          )}
        </p>
        {totals !== undefined && !totals.canCheckout && (
          <p className={styles['c-cart-totals__notice']}>
            {cartTexts.minBasketRemainingLabel}:{' '}
            <span className={styles['c-cart-totals__nowrap']}>
              {money(totals.amountToMinBasketMinor)}
            </span>
          </p>
        )}
        {totals !== undefined && totals.amountToFreeDeliveryMinor > 0 && (
          <p className={styles['c-cart-totals__notice']}>
            {texts.freeDeliveryRemainingLabel}:{' '}
            <span className={styles['c-cart-totals__nowrap']}>
              {money(totals.amountToFreeDeliveryMinor)}
            </span>
          </p>
        )}
      </div>
      {totals?.canCheckout === true ? (
        <Link to={checkoutHref} className={styles['c-cart-totals__checkout']}>
          {texts.checkoutLabel}
        </Link>
      ) : (
        <button type="button" className={styles['c-cart-totals__checkout']} aria-disabled="true">
          {texts.checkoutLabel}
        </button>
      )}
    </section>
  );
}
