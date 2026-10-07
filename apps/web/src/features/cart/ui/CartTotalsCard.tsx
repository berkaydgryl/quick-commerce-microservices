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
  /** Sepet paneliyle ayni metinler: notlar, "Teslimat Ücreti", "Ücretsiz", "Toplam". */
  readonly cartTexts: Pick<
    MarketListCartContent,
    | 'minBasketRemainingLabel'
    | 'closedNotice'
    | 'deliveryLabel'
    | 'freeDeliveryLabel'
    | 'totalLabel'
  >;
  /** Odeme sayfasi (T17.1); sayfa verir: sepet odeme sayfasini tanimaz. */
  readonly checkoutHref: string;
  /** Sepetin marketi kapali (07.10): not ve "Ödemeye Geç" PASIF. */
  readonly closed?: boolean | undefined;
}

/**
 * "Sepet Toplamı" (T16.3; referans getircarsi; F15'te odeme ozetiyle ayni duzen):
 * "Sepet Tutarı", "Teslimat Ücreti" (esik gecildiyse "Ücretsiz") ve "Toplam"
 * (tanim listesi; kurallar gelmeden satirlar bos durur, dugme kaymaz);
 * altinda minimum sepete ve ucretsiz teslimata kalan (T16.3 olcutu), sonra mor
 * "Ödemeye Geç": odeme sayfasina (T17.1) baglanti. Minimum sepet tutmazsa ya
 * da kurallar gelmediyse PASIF (aria-disabled): odeme sayfasinda da siparis
 * verilemezdi. Market kapaliysa (07.10) de PASIF ve notu gorunur. Hesap
 * @getir/pricing'te; durumsuz.
 */
export function CartTotalsCard({
  totals,
  texts,
  cartTexts,
  checkoutHref,
  closed = false,
}: CartTotalsCardProps) {
  const titleId = useId();
  const closedId = useId();
  return (
    <section className={styles['c-cart-totals']} aria-labelledby={titleId}>
      <h2 id={titleId} className={styles['c-cart-totals__title']}>
        {texts.totalsTitle}
      </h2>
      <div className={styles['c-cart-totals__card']}>
        <dl className={styles['c-cart-totals__lines']}>
          <div className={styles['c-cart-totals__row']}>
            <dt>{texts.subtotalLabel}</dt>
            <dd className={styles['c-cart-totals__nowrap']}>
              {totals === undefined ? null : money(totals.subtotalMinor)}
            </dd>
          </div>
          <div className={styles['c-cart-totals__row']}>
            <dt>{cartTexts.deliveryLabel}</dt>
            <dd className={styles['c-cart-totals__nowrap']}>
              {totals === undefined
                ? null
                : totals.deliveryFeeMinor === 0
                  ? cartTexts.freeDeliveryLabel
                  : money(totals.deliveryFeeMinor)}
            </dd>
          </div>
          <div className={`${styles['c-cart-totals__row']} ${styles['c-cart-totals__row--total']}`}>
            <dt>{cartTexts.totalLabel}</dt>
            <dd className={styles['c-cart-totals__nowrap']}>
              {totals === undefined ? null : money(totals.totalMinor)}
            </dd>
          </div>
        </dl>
        {closed && (
          <p id={closedId} className={styles['c-cart-totals__notice']}>
            {cartTexts.closedNotice}
          </p>
        )}
        {!closed && totals !== undefined && !totals.canCheckout && (
          <p className={styles['c-cart-totals__notice']}>
            {cartTexts.minBasketRemainingLabel}:{' '}
            <span className={styles['c-cart-totals__nowrap']}>
              {money(totals.amountToMinBasketMinor)}
            </span>
          </p>
        )}
        {!closed && totals !== undefined && totals.amountToFreeDeliveryMinor > 0 && (
          <p className={styles['c-cart-totals__notice']}>
            {texts.freeDeliveryRemainingLabel}:{' '}
            <span className={styles['c-cart-totals__nowrap']}>
              {money(totals.amountToFreeDeliveryMinor)}
            </span>
          </p>
        )}
      </div>
      {!closed && totals?.canCheckout === true ? (
        <Link to={checkoutHref} className={styles['c-cart-totals__checkout']}>
          {texts.checkoutLabel}
        </Link>
      ) : (
        <button
          type="button"
          className={styles['c-cart-totals__checkout']}
          aria-disabled="true"
          aria-describedby={closed ? closedId : undefined}
        >
          {texts.checkoutLabel}
        </button>
      )}
    </section>
  );
}
