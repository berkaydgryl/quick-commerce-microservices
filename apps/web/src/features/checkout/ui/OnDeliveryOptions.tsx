import type { CheckoutContent, DeliveryPaymentKind } from '@getir/contracts';
import { useId } from 'react';

import styles from './OnDeliveryOptions.module.css';

export type OnDeliveryTexts = Pick<
  CheckoutContent,
  'onDeliveryTitle' | 'onDeliveryCashLabel' | 'onDeliveryPosLabel'
>;

/** Seceneklerin sirasi ve etiketi: nakit, sonra kuryenin POS cihazindan kart. */
const OPTIONS: readonly {
  readonly kind: DeliveryPaymentKind;
  readonly label: keyof OnDeliveryTexts;
}[] = [
  { kind: 'CASH', label: 'onDeliveryCashLabel' },
  { kind: 'POS', label: 'onDeliveryPosLabel' },
];

interface OnDeliveryOptionsProps {
  /** Radyo grubunun adi: pencerede kartlarla AYNI grup (tek secim). */
  readonly name: string;
  readonly selected: DeliveryPaymentKind | undefined;
  /**
   * Bu siparis icin kapida odeme reddedildi (422; F12): secenekler pasif ve
   * sunucunun cumlesi grubun altinda; yoksa undefined.
   */
  readonly refusedNotice?: string | undefined;
  readonly texts: OnDeliveryTexts;
  readonly onPick: (kind: DeliveryPaymentKind) => void;
}

/**
 * "Kapıda Ödeme" (F12; kullanici istegi): "Online Ödeme"nin altinda baslik ve
 * iki radyo, "Nakit" ve "Kapıda Kredi/Banka Kartı". Kartlarla ayni radyo grubu
 * (ok tuslari tarayicinin). Kasa kapali pakette pencerede yalniz bu grup var.
 * Durumsuz: secimi pencere tutar.
 */
export function OnDeliveryOptions({
  name,
  selected,
  refusedNotice,
  texts,
  onPick,
}: OnDeliveryOptionsProps) {
  const noticeId = useId();
  const refused = refusedNotice !== undefined;
  return (
    <fieldset
      className={styles['c-on-delivery']}
      disabled={refused}
      aria-describedby={refused ? noticeId : undefined}
    >
      <legend className={styles['c-on-delivery__legend']}>{texts.onDeliveryTitle}</legend>
      <ul className={styles['c-on-delivery__rows']} role="list">
        {OPTIONS.map((option) => (
          <li key={option.kind} className={styles['c-on-delivery__row']}>
            <label className={styles['c-on-delivery__option']}>
              <input
                type="radio"
                className={styles['c-on-delivery__radio']}
                name={name}
                value={option.kind}
                checked={selected === option.kind}
                onChange={() => onPick(option.kind)}
              />
              {texts[option.label]}
            </label>
          </li>
        ))}
      </ul>
      {refused && (
        <p id={noticeId} className={styles['c-on-delivery__notice']}>
          {refusedNotice}
        </p>
      )}
    </fieldset>
  );
}
