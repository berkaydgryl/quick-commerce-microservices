import type { MarketListCartContent } from '@getir/contracts';

import { TrashIcon } from '../../address/ui/icons';

import styles from './CartQuantityStepper.module.css';

export type CartStepperTexts = Pick<
  MarketListCartContent,
  'decreaseSuffix' | 'increaseSuffix' | 'removeSuffix' | 'quantitySuffix'
>;

/** Yatay: sepet paneli ve arama satiri; dikey: magaza sayfasinin urun karti (T16.2). */
export type CartStepperOrientation = 'horizontal' | 'vertical';

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
  readonly orientation?: CartStepperOrientation | undefined;
  /**
   * "+" kapaliyken sebebi (07.10, kapali market): verilirse "+" odaklanir ve
   * sebebe baglanir (aria-disabled), basinca hicbir sey olmaz; yoksa disabled.
   */
  readonly incrementReasonId?: string | undefined;
}

/**
 * Sepet adet kutusu (T16.3; referans getircarsi): beyaz kutuda solda "−",
 * ortada mor kutuda adet, sagda "+". Adet 1'de "−" yerine cop kutusu cikar:
 * azaltmak zaten silmektir. "+"nin acik olup olmadigina cagiran karar verir
 * (sepet panelinde kalemin siniri, urun kartinda canAdd).
 *
 * Dikey kutu (urun karti) ustte "+", ortada adet, altta "−": DOM sirasi da
 * gorunen sira, Tab sirasi gozun sirasiyla ayni kalir.
 */
export function CartQuantityStepper({
  name,
  quantity,
  canIncrement,
  texts,
  onIncrement,
  onDecrement,
  orientation = 'horizontal',
  incrementReasonId,
}: CartQuantityStepperProps) {
  // Sebebi soylenen pasif "+" odakta kalir (aria-disabled); digerleri disabled.
  const explained = !canIncrement && incrementReasonId !== undefined;
  const last = quantity === 1;
  const vertical = orientation === 'vertical';
  const decrease = (
    <button
      type="button"
      className={styles['c-cart-stepper__step']}
      aria-label={`${name} ${last ? texts.removeSuffix : texts.decreaseSuffix}`}
      onClick={onDecrement}
    >
      {last ? <TrashIcon /> : <span aria-hidden="true">−</span>}
    </button>
  );
  const increase = (
    <button
      type="button"
      className={styles['c-cart-stepper__step']}
      aria-label={`${name} ${texts.increaseSuffix}`}
      disabled={!canIncrement && !explained}
      aria-disabled={explained ? true : undefined}
      aria-describedby={explained ? incrementReasonId : undefined}
      onClick={canIncrement ? onIncrement : undefined}
    >
      <span aria-hidden="true">+</span>
    </button>
  );
  return (
    <div
      className={
        vertical
          ? `${styles['c-cart-stepper']} ${styles['c-cart-stepper--vertical']}`
          : styles['c-cart-stepper']
      }
      role="group"
      aria-label={`${name} ${texts.quantitySuffix}`}
    >
      {vertical ? increase : decrease}
      <span className={styles['c-cart-stepper__quantity']} aria-live="polite">
        {quantity}
      </span>
      {vertical ? decrease : increase}
    </div>
  );
}
