import { CARD_FIELD_MESSAGES, SAVED_CARDS_MAX } from '@getir/contracts';
import type { PaymentMethodsContent, SavedCard } from '@getir/contracts';
import { useId } from 'react';
import { Link } from 'react-router-dom';

import { PlusIcon, TrashIcon } from '../../features/address/ui/icons';
import {
  cardShortName,
  faceHolderName,
  formatCardExpiry,
  savedCardFace,
} from '../../features/cards/services/card-face';
import { CardVisual } from '../../features/cards/ui/CardVisual';
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
  /** Pencere metinleri yuklenmedi: cop kutulari bekler (Adreslerim gibi). */
  readonly actionsDisabled: boolean;
  readonly onDelete: (card: SavedCard) => void;
}

/**
 * Odeme Yontemlerim (T11.17; M4): kayitli kartlar kucuk kart gorselleriyle
 * (kartin kendi rengi, ilk 4 ve son 4 hane), altinda kisa adi ("Visa ••••
 * 4242"), suresi gectiyse rozet ve cop kutusu. Sonda kart biciminde "Kart
 * ekle"; kasa doluysa (SAVED_CARDS_MAX) onun yerine sozlesmenin cumlesi:
 * kullanici formu doldurup ancak kaydederken ogrenmesin. Durumsuz: silmeyi
 * sayfa yapar.
 */
export function PaymentMethodsView({
  texts,
  cards,
  error,
  onRetry,
  addHref,
  actionsDisabled,
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
        <>
          {cards.length === 0 && (
            <p className={styles['c-payment-methods__empty']}>{texts.emptyNotice}</p>
          )}
          <ul className={styles['c-payment-methods__grid']} role="list">
            {cards.map((card) => {
              const name = cardShortName(card, texts.brandLabels);
              return (
                <li
                  key={card.id}
                  className={
                    card.expired
                      ? `${styles['c-payment-methods__tile']} ${styles['is-expired']}`
                      : styles['c-payment-methods__tile']
                  }
                >
                  <div className={styles['c-payment-methods__visual']}>
                    <CardVisual
                      size="small"
                      brand={card.brand}
                      groups={savedCardFace(card)}
                      holderName={faceHolderName(card.holderName, texts.holderPlaceholder)}
                      expiry={formatCardExpiry(card.expiryMonth, card.expiryYear)}
                      nickname={card.nickname ?? ''}
                      cvvMask=""
                      texts={texts}
                    />
                  </div>
                  <div className={styles['c-payment-methods__meta']}>
                    <span className={styles['c-payment-methods__name']}>{name}</span>
                    {card.expired && (
                      <span className={styles['c-payment-methods__expired']}>
                        {texts.expiredLabel}
                      </span>
                    )}
                    <button
                      type="button"
                      className={styles['c-payment-methods__delete']}
                      aria-label={`${name} ${texts.deleteSuffix}`}
                      disabled={actionsDisabled}
                      onClick={() => onDelete(card)}
                    >
                      <TrashIcon />
                    </button>
                  </div>
                </li>
              );
            })}
            <li className={styles['c-payment-methods__tile']}>
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
        </>
      )}
    </section>
  );
}
