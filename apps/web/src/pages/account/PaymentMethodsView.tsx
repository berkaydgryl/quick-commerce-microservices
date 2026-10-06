import { CARD_FIELD_MESSAGES, SAVED_CARDS_MAX } from '@getir/contracts';
import type { PaymentMethodsContent, SavedCard } from '@getir/contracts';
import { useId } from 'react';
import { Link } from 'react-router-dom';

import { PlusIcon, TrashIcon } from '../../features/address/ui/icons';
import { cardSpokenName, maskedCardNumber } from '../../features/cards/services/card-face';
import { BrandLogo } from '../../features/cards/ui/BrandLogo';
import { QueryError, QueryLoading } from '../../shared/ui/query-status/QueryStatus';

import styles from './PaymentMethodsView.module.css';

export interface PaymentMethodsViewProps {
  readonly texts: PaymentMethodsContent;
  /** Kayitli kartlar, yeniden eskiye; sorgu bitene kadar undefined. */
  readonly cards: readonly SavedCard[] | undefined;
  readonly error: Error | null;
  readonly onRetry: () => void;
  /** Kart ekle sayfasinin adresi. */
  readonly addHref: string;
  readonly onDelete: (card: SavedCard) => void;
}

/**
 * Odeme Yontemlerim (T11.17; duzen kullanicinin referansi getircarsi): beyaz
 * kutuda ince ayiricili satirlar. Satir: solda marka logosu, ortada kart adi
 * (yoksa marka adi) ve maskeli numara ("4242 **** **** 4242"), suresi
 * gectiyse etiket, sagda cop kutusu. Son satir "+ Kredi/Banka Kartı"; kasa
 * doluysa onun yerine sozlesmenin cumlesi; karti olmayan hesapta yalnizca bu
 * satir. Durumsuz: silmeyi sayfa yapar.
 *
 * Ekran okuyucu gorunen ad ve maskeyi degil, gizli metni okur (QA D6):
 * "Maaş kartım, Mastercard, son dört hane 4444"; kart adi yoksa markayla baslar.
 */
export function PaymentMethodsView({
  texts,
  cards,
  error,
  onRetry,
  addHref,
  onDelete,
}: PaymentMethodsViewProps) {
  const titleId = useId();
  const loading = cards === undefined && error === null;

  return (
    <section className={styles['c-payment-methods']} aria-labelledby={titleId} aria-busy={loading}>
      <h1 id={titleId} className={styles['c-payment-methods__title']}>
        {texts.title}
      </h1>
      {loading && <QueryLoading>{texts.loadingLabel}</QueryLoading>}
      {cards === undefined && error !== null && <QueryError error={error} onRetry={onRetry} />}
      {cards !== undefined && (
        <ul className={styles['c-payment-methods__list']} role="list">
          {cards.map((card) => {
            const spoken = cardSpokenName(card, texts.brandLabels, texts.lastFourLabel);
            return (
              <li
                key={card.id}
                className={
                  card.expired
                    ? `${styles['c-payment-methods__row']} ${styles['is-expired']}`
                    : styles['c-payment-methods__row']
                }
              >
                <span className={styles['c-payment-methods__logo']}>
                  <BrandLogo brand={card.brand} mark={texts.brandMarks[card.brand]} />
                </span>
                <span className={styles['c-payment-methods__text']}>
                  <span className={styles['c-payment-methods__spoken']}>
                    {card.nickname === undefined ? spoken : `${card.nickname}, ${spoken}`}
                  </span>
                  <span className={styles['c-payment-methods__name']} aria-hidden="true">
                    {card.nickname ?? texts.brandLabels[card.brand]}
                  </span>
                  <span className={styles['c-payment-methods__number']} aria-hidden="true">
                    {maskedCardNumber(card)}
                  </span>
                </span>
                {card.expired && (
                  <span className={styles['c-payment-methods__expired']}>{texts.expiredLabel}</span>
                )}
                <button
                  type="button"
                  className={styles['c-payment-methods__delete']}
                  aria-label={`${spoken} ${texts.deleteSuffix}`}
                  onClick={() => onDelete(card)}
                >
                  <TrashIcon />
                </button>
              </li>
            );
          })}
          <li className={styles['c-payment-methods__row']}>
            {cards.length < SAVED_CARDS_MAX ? (
              <Link to={addHref} className={styles['c-payment-methods__add']}>
                <span className={styles['c-payment-methods__add-icon']} aria-hidden="true">
                  <PlusIcon />
                </span>
                {texts.addLabel}
              </Link>
            ) : (
              <p className={styles['c-payment-methods__full']}>{CARD_FIELD_MESSAGES.cards}</p>
            )}
          </li>
        </ul>
      )}
    </section>
  );
}
