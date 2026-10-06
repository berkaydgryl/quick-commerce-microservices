import type { CardBrand } from '@getir/contracts';

import type { CardFaceGroups } from '../services/card-face';

import styles from './CardFront.module.css';

/** Kartin hangi bolgesi isaretli (form alanina odak): tasarim B'nin cercevesi. */
export type CardFocus = 'number' | 'holderName' | 'expiry' | null;

interface CardFrontProps {
  readonly brand: CardBrand | null;
  /** Rozet yazisi ("Visa") ve soluk kisa isaret ("VISA", "MC"); marka yoksa bos. */
  readonly brandLabel: string;
  readonly brandMark: string;
  readonly groups: CardFaceGroups;
  readonly holderName: string;
  readonly expiry: string;
  readonly nickname: string;
  readonly holderCaption: string;
  readonly expiryCaption: string;
  readonly focus: CardFocus;
}

const BADGE_CLASS: Readonly<Record<CardBrand, string | undefined>> = {
  VISA: styles['c-payment-card__badge--visa'],
  MASTERCARD: styles['c-payment-card__badge--mastercard'],
  AMEX: styles['c-payment-card__badge--amex'],
  TROY: styles['c-payment-card__badge--troy'],
};

const FRAME_CLASS: Readonly<Record<Exclude<CardFocus, null>, string | undefined>> = {
  number: styles['c-payment-card__frame--number'],
  holderName: styles['c-payment-card__frame--holder'],
  expiry: styles['c-payment-card__frame--expiry'],
};

const join = (...names: readonly (string | false | undefined)[]) =>
  names.filter((name): name is string => typeof name === 'string' && name !== '').join(' ');

/**
 * Kartin on yuzu (T11.17, tasarim B): kart adi, rozet (D3: kendimiz ciziyoruz),
 * cip, temassiz isareti, numara (yalnizca ilk 4 ve son 4 hane, M7), kart
 * sahibi ve son kullanma, soluk kisa isaret, isik seridi, yazilan hanenin
 * dusmesi, odak cercevesi ve parlama.
 */
export function CardFront({
  brand,
  brandLabel,
  brandMark,
  groups,
  holderName,
  expiry,
  nickname,
  holderCaption,
  expiryCaption,
  focus,
}: CardFrontProps) {
  return (
    <>
      <span className={styles['c-payment-card__streak']} />
      <span className={styles['c-payment-card__mark']}>{brandMark}</span>
      <span className={styles['c-payment-card__nickname']}>{nickname}</span>
      {brand !== null && (
        <span className={join(styles['c-payment-card__badge'], BADGE_CLASS[brand])}>
          {brandLabel}
        </span>
      )}
      <span className={styles['c-payment-card__chip']} />
      <svg
        className={styles['c-payment-card__contactless']}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        focusable="false"
      >
        <path d="M8 7a7 7 0 0 1 0 10" />
        <path d="M12 4.5a11 11 0 0 1 0 15" />
        <path d="M16 2a15 15 0 0 1 0 20" />
      </svg>
      <span className={styles['c-payment-card__number']}>
        {groups.map((group, groupIndex) => (
          <span key={groupIndex} className={styles['c-payment-card__group']}>
            {group.map((char, charIndex) => (
              <span
                key={charIndex}
                className={join(
                  styles['c-payment-card__char'],
                  char.kind === 'empty' && styles['c-payment-card__char--empty'],
                  char.kind !== 'empty' && styles['c-payment-card__char--animated'],
                )}
              >
                {char.char}
              </span>
            ))}
          </span>
        ))}
      </span>
      <span className={styles['c-payment-card__holder']}>
        <span className={styles['c-payment-card__caption']}>{holderCaption}</span>
        <span className={styles['c-payment-card__value']}>{holderName}</span>
      </span>
      <span className={styles['c-payment-card__expiry']}>
        <span className={styles['c-payment-card__caption']}>{expiryCaption}</span>
        <span className={styles['c-payment-card__value']}>{expiry}</span>
      </span>
      <span
        className={join(
          styles['c-payment-card__frame'],
          focus !== null && FRAME_CLASS[focus],
          focus !== null && styles['is-visible'],
        )}
      />
      <span className={styles['c-payment-card__glare']} />
    </>
  );
}
