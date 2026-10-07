import type { MarketListCartContent } from '@getir/contracts';

import { TrashIcon } from '../../address/ui/icons';

import styles from './CartQuantityStepper.module.css';

export type CartStepperTexts = Pick<
  MarketListCartContent,
  'decreaseSuffix' | 'increaseSuffix' | 'removeSuffix' | 'quantitySuffix'
>;

interface CartQuantityStepperProps {
  /** Urunun adi: dugmelerin erisilebilir adlarinin basi ("Saksıda Küçük Ağaç adedini azalt"). */
  readonly name: string;
  readonly quantity: number;
  /** "+" acik mi (sinir cart-state'te: canIncrement / canAdd). */
  readonly canIncrement: boolean;
  readonly texts: CartStepperTexts;
  readonly onIncrement: () => void;
  /** Bir azaltir; adet 1'de kalem kalkar (azaltmak silmek demektir). */
  readonly onDecrement: () => void;
}

/**
 * Sepet adet kutusu (T16.3; referans getircarsi): beyaz kutuda solda "−",
 * ortada mor kutuda adet, sagda "+". Adet 1'de "−" yerine cop kutusu cikar:
 * azaltmak zaten silmektir. "+"nin acik olup olmadigina cagiran karar verir
 * (sepet panelinde kalemin siniri).
 */
export function CartQuantityStepper({
  name,
  quantity,
  canIncrement,
  texts,
  onIncrement,
  onDecrement,
}: CartQuantityStepperProps) {
  const last = quantity === 1;
  return (
    <div
      className={styles['c-cart-stepper']}
      role="group"
      aria-label={`${name} ${texts.quantitySuffix}`}
    >
      <button
        type="button"
        className={styles['c-cart-stepper__step']}
        aria-label={`${name} ${last ? texts.removeSuffix : texts.decreaseSuffix}`}
        onClick={onDecrement}
      >
        {last ? <TrashIcon /> : <span aria-hidden="true">−</span>}
      </button>
      <span className={styles['c-cart-stepper__quantity']} aria-live="polite">
        {quantity}
      </span>
      <button
        type="button"
        className={styles['c-cart-stepper__step']}
        aria-label={`${name} ${texts.increaseSuffix}`}
        disabled={!canIncrement}
        onClick={onIncrement}
      >
        <span aria-hidden="true">+</span>
      </button>
    </div>
  );
}
