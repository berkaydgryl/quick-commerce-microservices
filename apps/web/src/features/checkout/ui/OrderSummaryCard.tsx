import type { CheckoutContent } from '@getir/contracts';
import { CURRENCY } from '@getir/core';
import type { CartTotals } from '@getir/pricing';
import { useId } from 'react';

import { formatMoney } from '../../../shared/services/format';

import { AgreementField } from './AgreementField';
import styles from './OrderSummaryCard.module.css';

const money = (amountMinor: number) => formatMoney({ amountMinor, currency: CURRENCY });

interface OrderSummaryCardProps {
  readonly totals: CartTotals | undefined;
  readonly agreementsAccepted: boolean;
  readonly onAgreementsChange: (accepted: boolean) => void;
  readonly texts: CheckoutContent;
}

/**
 * Odeme Ozeti (T17.1; referans getircarsi #33; KAMPANYA YOK): "Sepet Tutarı",
 * "Teslimat Ücreti" (PM karari M5) ve "Ödenecek Tutar"; altinda ayri kartta
 * sozlesme onayi; en altta "Sipariş Ver" ve tutari. Dugme siparis akisi (F4b) gelene kadar PASIF.
 * Hesap @getir/pricing'te; durumsuz.
 */
export function OrderSummaryCard({
  totals,
  agreementsAccepted,
  onAgreementsChange,
  texts,
}: OrderSummaryCardProps) {
  const titleId = useId();
  return (
    <section className={styles['c-order-summary']} aria-labelledby={titleId}>
      <h2 id={titleId} className={styles['c-order-summary__title']}>
        {texts.summaryTitle}
      </h2>
      <div className={styles['c-order-summary__card']}>
        <dl className={styles['c-order-summary__lines']}>
          <div className={styles['c-order-summary__line']}>
            <dt>{texts.subtotalLabel}</dt>
            <dd>{totals === undefined ? null : money(totals.subtotalMinor)}</dd>
          </div>
          <div className={styles['c-order-summary__line']}>
            <dt>{texts.deliveryFeeRowLabel}</dt>
            <dd>
              {totals === undefined
                ? null
                : totals.deliveryFeeMinor === 0
                  ? texts.freeLabel
                  : money(totals.deliveryFeeMinor)}
            </dd>
          </div>
          <div
            className={`${styles['c-order-summary__line']} ${styles['c-order-summary__line--total']}`}
          >
            <dt>{texts.payableLabel}</dt>
            <dd>{totals === undefined ? null : money(totals.totalMinor)}</dd>
          </div>
        </dl>
      </div>
      <div className={styles['c-order-summary__card']}>
        <AgreementField checked={agreementsAccepted} onChange={onAgreementsChange} texts={texts} />
      </div>
      <button type="button" className={styles['c-order-summary__place']} aria-disabled="true">
        <span className={styles['c-order-summary__place-label']}>{texts.placeOrderLabel}</span>
        {totals !== undefined && (
          <span className={styles['c-order-summary__place-amount']}>
            {money(totals.totalMinor)}
          </span>
        )}
      </button>
    </section>
  );
}
