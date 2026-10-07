import type { CheckoutContent, PaymentMethodsContent, SavedCard } from '@getir/contracts';
import type { ReactNode, Ref } from 'react';

import { SectionCard } from '../../../shared/ui/section-card/SectionCard';
import { cardSpokenName, maskedCardNumber } from '../../cards/services/card-face';
import { BrandLogo } from '../../cards/ui/BrandLogo';
import type { PaymentChoice } from '../services/payment-choice';

import styles from './PaymentMethod.module.css';

export type PaymentMethodTexts = Pick<
  CheckoutContent,
  | 'paymentTitle'
  | 'changeLabel'
  | 'chooseLabel'
  | 'cardsLoadingLabel'
  | 'noCardNotice'
  | 'securityNote'
  | 'onDeliveryCashSummary'
  | 'onDeliveryPosSummary'
>;

export type PaymentCardTexts = Pick<
  PaymentMethodsContent,
  'brandLabels' | 'brandMarks' | 'lastFourLabel'
>;

interface PaymentMethodViewProps {
  readonly loading: boolean;
  /** Kartlar okunamadi: kart satirinin yerine durum ve "Tekrar dene" (kart yok sanilmasin). */
  readonly problem?: ReactNode;
  /** Sayfadaki secim (F12): kart ya da kapida odeme; yoksa "Seç". */
  readonly choice: PaymentChoice | undefined;
  /** Secili kartin kendisi (kart seciminde; logo, ad, maskeli numara). */
  readonly card: SavedCard | undefined;
  readonly texts: PaymentMethodTexts;
  readonly cardTexts: PaymentCardTexts;
  /** "Değiştir" / "Seç": odeme yontemi penceresi; yoksa dugme PASIF (siparis suruyor). */
  readonly onChange?: (() => void) | undefined;
  /** Gorunen dugme: pencere kapaninca odak buraya doner. */
  readonly actionRef?: Ref<HTMLButtonElement> | undefined;
}

/**
 * Odeme Yontemi (T17.1; referans getircarsi #33): kartin icinde secim satiri
 * ve sagda cerceveli "Değiştir". Kartta logo, kart adi ve maskeli numara;
 * kapida odemede "Kapıda nakit" ya da "Kapıda kredi/banka kartı" (F12).
 * Secim yoksa (kayitli kart yok, kapida odeme secilmedi) not ve "Seç".
 * Dugme odeme yontemi penceresini acar (F5); siparis surerken PASIF. Ince
 * ayiricidan sonra kendi guvenlik cumlemiz (kayitli kartla odemeyi anlatir:
 * yalniz kart seciliyken). Kartin numarasi yalnizca ilk 4 ve
 * son 4 (kasanin verdigi); PAN ve CVV bu sayfada YOK (M7). Durumsuz.
 */
export function PaymentMethodView({
  loading,
  problem,
  choice,
  card,
  texts,
  cardTexts,
  onChange,
  actionRef,
}: PaymentMethodViewProps) {
  const onDelivery = choice?.kind === 'onDelivery' ? choice.onDelivery : undefined;
  const ready = onDelivery !== undefined || (!loading && problem === undefined);
  const action = (label: string, className: string | undefined) => (
    <button
      ref={actionRef}
      type="button"
      className={className}
      aria-disabled={onChange === undefined ? 'true' : undefined}
      onClick={onChange}
    >
      {label}
    </button>
  );
  return (
    <SectionCard title={texts.paymentTitle}>
      {onDelivery === undefined && loading && (
        <p className={styles['c-payment-method__muted']}>{texts.cardsLoadingLabel}</p>
      )}
      {onDelivery === undefined && problem !== undefined && (
        // Kartlar okunamasa da kapida odeme secilebilir: pencere acilir (inceleme).
        <div className={styles['c-payment-method__row']}>
          {problem}
          {action(texts.chooseLabel, styles['c-payment-method__add'])}
        </div>
      )}
      {ready && onDelivery !== undefined && (
        <div className={styles['c-payment-method__row']}>
          <p className={styles['c-payment-method__name']}>
            {onDelivery === 'CASH' ? texts.onDeliveryCashSummary : texts.onDeliveryPosSummary}
          </p>
          {action(texts.changeLabel, styles['c-payment-method__change'])}
        </div>
      )}
      {ready && onDelivery === undefined && card !== undefined && (
        <div className={styles['c-payment-method__row']}>
          <p className={styles['c-payment-method__card']}>
            <span className={styles['c-payment-method__logo']}>
              <BrandLogo brand={card.brand} mark={cardTexts.brandMarks[card.brand]} />
            </span>
            <span className={styles['c-payment-method__sr']}>
              {cardSpokenName(card, cardTexts.brandLabels, cardTexts.lastFourLabel)}
            </span>
            <span className={styles['c-payment-method__text']} aria-hidden="true">
              <span className={styles['c-payment-method__name']}>
                {card.nickname ?? cardTexts.brandLabels[card.brand]}
              </span>
              <span className={styles['c-payment-method__number']}>{maskedCardNumber(card)}</span>
            </span>
          </p>
          {action(texts.changeLabel, styles['c-payment-method__change'])}
        </div>
      )}
      {ready && onDelivery === undefined && card === undefined && (
        <div className={styles['c-payment-method__row']}>
          <p className={styles['c-payment-method__muted']}>{texts.noCardNotice}</p>
          {action(texts.chooseLabel, styles['c-payment-method__add'])}
        </div>
      )}
      {choice?.kind === 'card' && (
        <p className={styles['c-payment-method__security']}>{texts.securityNote}</p>
      )}
    </SectionCard>
  );
}
