import type { CheckoutContent, PaymentMethodsContent, SavedCard } from '@getir/contracts';
import type { ReactNode, Ref } from 'react';

import { SectionCard } from '../../../shared/ui/section-card/SectionCard';
import { cardSpokenName, maskedCardNumber } from '../../cards/services/card-face';
import { BrandLogo } from '../../cards/ui/BrandLogo';

import styles from './PaymentMethod.module.css';

export type PaymentMethodTexts = Pick<
  CheckoutContent,
  | 'paymentTitle'
  | 'changeLabel'
  | 'addCardLabel'
  | 'cardsLoadingLabel'
  | 'noCardNotice'
  | 'securityNote'
>;

export type PaymentCardTexts = Pick<
  PaymentMethodsContent,
  'brandLabels' | 'brandMarks' | 'lastFourLabel'
>;

interface PaymentMethodViewProps {
  readonly loading: boolean;
  /** Kartlar okunamadi: kart satirinin yerine durum ve "Tekrar dene" (kart yok sanilmasin). */
  readonly problem?: ReactNode;
  /** Secili kart (suresi gecmemis en yeni; M4); yoksa "Kart ekle". */
  readonly card: SavedCard | undefined;
  readonly texts: PaymentMethodTexts;
  readonly cardTexts: PaymentCardTexts;
  /** "Değiştir": odeme yontemi penceresi (F5); yoksa dugme PASIF (kasa kapali ya da siparis suruyor). */
  readonly onChange?: (() => void) | undefined;
  /** "Kart ekle": pencerenin ekleme adimi (F5); yoksa PASIF. */
  readonly onAdd?: (() => void) | undefined;
  /** Gorunen dugme ("Değiştir" ya da "Kart ekle"): pencere kapaninca odak buraya doner. */
  readonly actionRef?: Ref<HTMLButtonElement> | undefined;
}

/**
 * Odeme Yontemi (T17.1; referans getircarsi #33): kartin icinde secili kart
 * satiri (logo, kart adi, maskeli numara) ve sagda cerceveli "Değiştir"; kart
 * yoksa "Kart ekle"; ince ayiricidan sonra kendi guvenlik cumlemiz (Masterpass
 * yok). "Değiştir" ve "Kart ekle" odeme yontemi penceresini (F5) acar;
 * kasa kapali pakette ve siparis surerken PASIF. Kartin numarasi yalnizca
 * ilk 4 ve son 4 (kasanin verdigi); PAN ve CVV bu sayfada YOK (M7). Durumsuz.
 */
export function PaymentMethodView({
  loading,
  problem,
  card,
  texts,
  cardTexts,
  onChange,
  onAdd,
  actionRef,
}: PaymentMethodViewProps) {
  const ready = !loading && problem === undefined;
  return (
    <SectionCard title={texts.paymentTitle}>
      {loading && <p className={styles['c-payment-method__muted']}>{texts.cardsLoadingLabel}</p>}
      {problem}
      {ready && card !== undefined && (
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
          <button
            ref={actionRef}
            type="button"
            className={styles['c-payment-method__change']}
            aria-disabled={onChange === undefined ? 'true' : undefined}
            onClick={onChange}
          >
            {texts.changeLabel}
          </button>
        </div>
      )}
      {ready && card === undefined && (
        <div className={styles['c-payment-method__row']}>
          <p className={styles['c-payment-method__muted']}>{texts.noCardNotice}</p>
          <button
            ref={actionRef}
            type="button"
            className={styles['c-payment-method__add']}
            aria-disabled={onAdd === undefined ? 'true' : undefined}
            onClick={onAdd}
          >
            {texts.addCardLabel}
          </button>
        </div>
      )}
      <p className={styles['c-payment-method__security']}>{texts.securityNote}</p>
    </SectionCard>
  );
}
