import type { CardBrand, CardBrandLabels } from '@getir/contracts';
import { useRef } from 'react';
import type { PointerEvent } from 'react';

import type { CardFaceGroups } from '../services/card-face';

import { CardBack } from './CardBack';
import { CardFront } from './CardFront';
import type { CardFocus } from './CardFront';
import { CardLayers } from './CardLayers';
import type { CardColor } from './CardLayers';
import styles from './CardVisual.module.css';

export type { CardFocus } from './CardFront';

export interface CardFaceTexts {
  readonly holderCaption: string;
  readonly expiryCaption: string;
  readonly cvvCaption: string;
  readonly cvvNote: string;
  readonly brandLabels: CardBrandLabels;
  /** Soluk buyuk isaret (kisa: "VISA", "MC"; tasarim B). */
  readonly brandMarks: CardBrandLabels;
}

export interface CardVisualProps {
  readonly brand: CardBrand | null;
  /** Numaranin yuzu: yalnizca ilk 4 ve son 4 hane (services/card-face.ts). */
  readonly groups: CardFaceGroups;
  readonly holderName: string;
  readonly expiry: string;
  readonly nickname: string;
  /** Arka yuzdeki CVV: yalnizca "•". */
  readonly cvvMask: string;
  readonly texts: CardFaceTexts;
  /** large: kart ekle sayfasi (egim, isik, donme); small: kayitli kart listesi. */
  readonly size: 'large' | 'small';
  /** CVV alaninda: kart arka yuzune doner. */
  readonly flipped?: boolean;
  readonly focus?: CardFocus;
}

const COLOR: Readonly<Record<CardBrand, CardColor>> = {
  VISA: 'visa',
  MASTERCARD: 'mastercard',
  AMEX: 'amex',
  TROY: 'troy',
};

const join = (...names: readonly (string | false | undefined)[]) =>
  names.filter((name): name is string => typeof name === 'string' && name !== '').join(' ');

/**
 * Odeme karti gorseli (T11.17, tasarim B "Markanin rengi"; M3): kabuk. Kartin
 * boyu ve orani, imlecle egim (buyuk kartta), CVV'de arka yuze donme ve iki
 * yuz; renk katmanlari CardLayers, yuzler CardFront ve CardBack. Hareket
 * azaltma acikken donme yerine yumusak gecis, egim yok.
 *
 * Suslemedir (aria-hidden): bilgi formda ve listede metin olarak var. Tam
 * numara buraya GELMEZ (M7): `groups` yalnizca ilk 4 ve son 4 haneyi tasir.
 */
export function CardVisual({
  brand,
  groups,
  holderName,
  expiry,
  nickname,
  cvvMask,
  texts,
  size,
  flipped = false,
  focus = null,
}: CardVisualProps) {
  const tilt = useRef<HTMLDivElement>(null);
  const large = size === 'large';
  const color: CardColor = brand === null ? 'default' : COLOR[brand];
  const brandLabel = brand === null ? '' : texts.brandLabels[brand];
  const brandMark = brand === null ? '' : texts.brandMarks[brand];

  const lean = (event: PointerEvent<HTMLDivElement>) => {
    const element = tilt.current;
    if (element === null) {
      return;
    }
    const box = element.getBoundingClientRect();
    element.style.setProperty('--tilt-x', String((event.clientX - box.left) / box.width - 0.5));
    element.style.setProperty('--tilt-y', String((event.clientY - box.top) / box.height - 0.5));
  };
  const rest = () => {
    tilt.current?.style.removeProperty('--tilt-x');
    tilt.current?.style.removeProperty('--tilt-y');
  };

  return (
    <div
      className={join(
        styles['c-payment-card'],
        large ? styles['c-payment-card--large'] : styles['c-payment-card--small'],
        flipped && styles['is-flipped'],
      )}
      aria-hidden="true"
    >
      <div
        ref={tilt}
        className={styles['c-payment-card__tilt']}
        onPointerMove={large ? lean : undefined}
        onPointerLeave={large ? rest : undefined}
      >
        <div className={styles['c-payment-card__flip']}>
          <div
            className={join(styles['c-payment-card__face'], styles['c-payment-card__face--front'])}
          >
            <CardLayers active={color} />
            <CardFront
              brand={brand}
              brandLabel={brandLabel}
              brandMark={brandMark}
              groups={groups}
              holderName={holderName}
              expiry={expiry}
              nickname={nickname}
              holderCaption={texts.holderCaption}
              expiryCaption={texts.expiryCaption}
              large={large}
              focus={focus}
            />
          </div>
          {large && (
            <div
              className={join(styles['c-payment-card__face'], styles['c-payment-card__face--back'])}
            >
              <CardLayers active={color} />
              <CardBack
                cvvMask={cvvMask}
                brandMark={brandMark}
                cvvCaption={texts.cvvCaption}
                cvvNote={texts.cvvNote}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
