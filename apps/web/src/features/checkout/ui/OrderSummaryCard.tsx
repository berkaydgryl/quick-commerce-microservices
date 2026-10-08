import type { CheckoutContent } from '@getir/contracts';
import { CURRENCY } from '@getir/core';
import type { CartTotals } from '@getir/pricing';
import { useId } from 'react';
import type { ReactNode } from 'react';

import { formatMoney } from '../../../shared/services/format';
import { formatCountdown } from '../../profile/services/code-window';
import type { RetryWait } from '../services/retry-wait';

import { AgreementField } from './AgreementField';
import styles from './OrderSummaryCard.module.css';

const money = (amountMinor: number) => formatMoney({ amountMinor, currency: CURRENCY });

interface OrderSummaryCardProps {
  readonly totals: CartTotals | undefined;
  readonly agreementsAccepted: boolean;
  readonly onAgreementsChange: (accepted: boolean) => void;
  readonly texts: CheckoutContent;
  /** Ilk eksik kosulun cumlesi (N1); varken dugme pasif ve cumle altinda. */
  readonly blocker: string | undefined;
  /**
   * Cok fazla hatali kod (429; F15b): dugme pasif; cumle BIR kez okunur
   * (role="alert"), geri sayim bolgenin DISINDA (kart formu FormAlert deseni).
   */
  readonly wait?: RetryWait | undefined;
  /** Istek suruyor: dugme "Sipariş veriliyor…" ve pasif. */
  readonly busy: boolean;
  /** Ozet kartinin altindaki durum satiri (erken rezervasyon: kalan sure ya da hata). */
  readonly status?: ReactNode;
  readonly onPlace: () => void;
}

/**
 * Odeme Ozeti (T17.1; referans getircarsi #33; KAMPANYA YOK): "Sepet Tutarı",
 * "Teslimat Ücreti" (PM karari M5) ve "Ödenecek Tutar"; altinda ayri kartta
 * sozlesme onayi; en altta "Sipariş Ver" ve tutari. Eksik kosul varken ya da
 * istek surerken dugme PASIF (aria-disabled: odaklanir, basilmaz) ve altinda
 * ilk eksik yazar (aria-describedby). Hesap @getir/pricing'te; durumsuz.
 */
export function OrderSummaryCard({
  totals,
  agreementsAccepted,
  onAgreementsChange,
  texts,
  blocker,
  wait,
  busy,
  status,
  onPlace,
}: OrderSummaryCardProps) {
  const titleId = useId();
  const hintId = useId();
  const hinted = blocker !== undefined || wait !== undefined;
  const disabled = hinted || busy;
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
        {status}
      </div>
      <div className={styles['c-order-summary__card']}>
        <AgreementField checked={agreementsAccepted} onChange={onAgreementsChange} texts={texts} />
      </div>
      <button
        type="button"
        className={styles['c-order-summary__place']}
        aria-disabled={disabled}
        aria-describedby={hinted ? hintId : undefined}
        onClick={() => {
          if (!disabled) onPlace();
        }}
      >
        <span className={styles['c-order-summary__place-label']}>
          {busy ? texts.placingLabel : texts.placeOrderLabel}
        </span>
        {totals !== undefined && (
          <span className={styles['c-order-summary__place-amount']}>
            {money(totals.totalMinor)}
          </span>
        )}
      </button>
      {wait !== undefined && (
        <p id={hintId} className={styles['c-order-summary__hint']}>
          <span role="alert">{wait.notice}</span> {wait.label}{' '}
          <time>{formatCountdown(wait.seconds)}</time>
        </p>
      )}
      {wait === undefined && blocker !== undefined && (
        <p id={hintId} className={styles['c-order-summary__hint']}>
          {blocker}
        </p>
      )}
    </section>
  );
}
