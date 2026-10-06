import styles from './CardBack.module.css';

interface CardBackProps {
  /** Arka yuzdeki CVV: yalnizca "•". */
  readonly cvvMask: string;
  /** Soluk kisa marka isareti ("VISA", "MC"); marka yoksa bos. */
  readonly brandMark: string;
  readonly cvvCaption: string;
  readonly cvvNote: string;
}

/**
 * Kartin arka yuzu (T11.17, tasarim B): manyetik serit, imza bandi, CVV
 * (maskeli), CVV'nin saklanmadigi notu ve soluk isaret. Yalnizca buyuk kartta.
 */
export function CardBack({ cvvMask, brandMark, cvvCaption, cvvNote }: CardBackProps) {
  return (
    <>
      <span className={styles['c-payment-card__stripe']} />
      <span className={styles['c-payment-card__signature']} />
      <span className={styles['c-payment-card__cvv-caption']}>{cvvCaption}</span>
      <span className={styles['c-payment-card__cvv']}>{cvvMask}</span>
      <span className={styles['c-payment-card__cvv-note']}>{cvvNote}</span>
      <span className={styles['c-payment-card__back-mark']}>{brandMark}</span>
    </>
  );
}
