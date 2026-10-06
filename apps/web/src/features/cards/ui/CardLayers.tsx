import styles from './CardLayers.module.css';

/** Kartin rengi: marka ya da (marka taninmadan) varsayilan mor. */
export type CardColor = 'default' | 'visa' | 'mastercard' | 'amex' | 'troy';

const LAYERS: readonly { readonly color: CardColor; readonly className: string | undefined }[] = [
  { color: 'default', className: styles['c-payment-card__layer--default'] },
  { color: 'visa', className: styles['c-payment-card__layer--visa'] },
  { color: 'mastercard', className: styles['c-payment-card__layer--mastercard'] },
  { color: 'amex', className: styles['c-payment-card__layer--amex'] },
  { color: 'troy', className: styles['c-payment-card__layer--troy'] },
];

/**
 * Kartin gradyan katmanlari (T11.17, tasarim B): hepsi ust uste, aktif olan
 * gorunur; marka degisince opaklik gecisiyle renk degisir. Acisi yuzden gelir
 * (--card-angle: on yuz 135deg, arka 225deg).
 */
export function CardLayers({ active }: { readonly active: CardColor }) {
  return (
    <>
      {LAYERS.map((layer) => (
        <span
          key={layer.color}
          className={[
            styles['c-payment-card__layer'],
            layer.className,
            layer.color === active ? styles['is-active'] : undefined,
          ]
            .filter(Boolean)
            .join(' ')}
        />
      ))}
    </>
  );
}
