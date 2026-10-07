import { CARD_FIELD_MESSAGES, SAVED_CARDS_MAX } from '@getir/contracts';
import type { CheckoutContent, PaymentMethodsContent, SavedCard } from '@getir/contracts';
import { useId } from 'react';

import { PlusIcon } from '../../address/ui/icons';
import { cardSpokenName, maskedCardNumber } from '../../cards/services/card-face';
import { BrandLogo } from '../../cards/ui/BrandLogo';
import { useStepFocus } from '../hooks/useStepFocus';
import type { ListFocus } from '../services/method-dialog';

import styles from './PaymentMethodList.module.css';

export type MethodListTexts = Pick<
  CheckoutContent,
  'onlinePaymentTitle' | 'deleteCardLabel' | 'chooseLabel'
>;

export type MethodListCardTexts = Pick<
  PaymentMethodsContent,
  'brandLabels' | 'brandMarks' | 'lastFourLabel' | 'expiredLabel' | 'addLabel'
>;

interface PaymentMethodListProps {
  readonly cards: readonly SavedCard[];
  /** Bekleyen secim (effectiveCard); gecerli kart yoksa undefined. */
  readonly selectedId: string | undefined;
  readonly focus: ListFocus;
  readonly texts: MethodListTexts;
  readonly cardTexts: MethodListCardTexts;
  readonly onPick: (cardId: string) => void;
  readonly onDelete: (card: SavedCard) => void;
  readonly onAdd: () => void;
  readonly onChoose: (cardId: string) => void;
}

/**
 * Odagin secicisi (P4): isaretli radyo (yoksa "+ Kredi/Banka Kartı"), ekleme
 * dugmesi ya da bir kartin "Kartı Sil"i (data-method-add, data-delete-for).
 * Kart kimligi sozlesmede crd_ + 32 onaltilik: secicide kacis gerekmez.
 */
function focusSelector(focus: ListFocus): string {
  switch (focus.kind) {
    case 'selected':
      return 'input[type="radio"]:checked, [data-method-add]';
    case 'add':
      return '[data-method-add]';
    case 'delete':
      return `[data-delete-for="${focus.cardId}"]`;
  }
}

/**
 * Pencerenin liste adimi (T17.1; F5; plan metni, #34-#37 diskte yok): "Online
 * Ödeme" basligi altinda kayitli kartlar radyo grubu (fieldset ve legend; ok
 * tuslari tarayicinin): logo, kart adi, maskeli numara. Suresi gecmis kart
 * listede ama secilemez; silinebilir. Secili kartin yaninda "Kartı Sil";
 * altta "+ Kredi/Banka Kartı" (Ödeme Yöntemlerim'e GITMEZ, ayni pencerede
 * ekleme adimi; kasa doluysa sozlesmenin cumlesi); mor "Seç". BKM Express ve
 * Masterpass YOK. Durumsuz: secimi pencere tutar.
 */
export function PaymentMethodList({
  cards,
  selectedId,
  focus,
  texts,
  cardTexts,
  onPick,
  onDelete,
  onAdd,
  onChoose,
}: PaymentMethodListProps) {
  const name = useId();
  const root = useStepFocus<HTMLDivElement>(
    focusSelector(focus),
    'input[type="radio"]:not(:disabled), button:not(:disabled)',
  );

  return (
    <div ref={root} className={styles['c-method-list']}>
      <fieldset className={styles['c-method-list__group']}>
        <legend className={styles['c-method-list__legend']}>{texts.onlinePaymentTitle}</legend>
        <ul className={styles['c-method-list__rows']} role="list">
          {cards.map((card) => {
            const spoken = cardSpokenName(card, cardTexts.brandLabels, cardTexts.lastFourLabel);
            return (
              <li
                key={card.id}
                className={
                  card.expired
                    ? `${styles['c-method-list__row']} ${styles['is-expired']}`
                    : styles['c-method-list__row']
                }
              >
                <label className={styles['c-method-list__option']}>
                  <input
                    type="radio"
                    className={styles['c-method-list__radio']}
                    name={name}
                    value={card.id}
                    checked={card.id === selectedId}
                    disabled={card.expired}
                    onChange={() => onPick(card.id)}
                  />
                  <span className={styles['c-method-list__logo']}>
                    <BrandLogo brand={card.brand} mark={cardTexts.brandMarks[card.brand]} />
                  </span>
                  <span className={styles['c-method-list__text']}>
                    <span className={styles['c-method-list__sr']}>
                      {card.nickname === undefined ? spoken : `${card.nickname}, ${spoken}`}
                    </span>
                    <span className={styles['c-method-list__name']} aria-hidden="true">
                      {card.nickname ?? cardTexts.brandLabels[card.brand]}
                    </span>
                    <span className={styles['c-method-list__number']} aria-hidden="true">
                      {maskedCardNumber(card)}
                    </span>
                  </span>
                  {card.expired && (
                    <span className={styles['c-method-list__expired']}>
                      {cardTexts.expiredLabel}
                    </span>
                  )}
                </label>
                {(card.id === selectedId || card.expired) && (
                  <button
                    type="button"
                    className={styles['c-method-list__delete']}
                    data-delete-for={card.id}
                    onClick={() => onDelete(card)}
                  >
                    {texts.deleteCardLabel}
                    <span className={styles['c-method-list__sr']}>, {spoken}</span>
                  </button>
                )}
              </li>
            );
          })}
          <li className={styles['c-method-list__row']}>
            {cards.length < SAVED_CARDS_MAX ? (
              <button
                type="button"
                className={styles['c-method-list__add']}
                data-method-add=""
                onClick={onAdd}
              >
                <span className={styles['c-method-list__add-icon']} aria-hidden="true">
                  <PlusIcon />
                </span>
                {cardTexts.addLabel}
              </button>
            ) : (
              <p className={styles['c-method-list__full']}>{CARD_FIELD_MESSAGES.cards}</p>
            )}
          </li>
        </ul>
      </fieldset>
      <button
        type="button"
        className={styles['c-method-list__choose']}
        disabled={selectedId === undefined}
        onClick={() => {
          if (selectedId !== undefined) {
            onChoose(selectedId);
          }
        }}
      >
        {texts.chooseLabel}
      </button>
    </div>
  );
}
