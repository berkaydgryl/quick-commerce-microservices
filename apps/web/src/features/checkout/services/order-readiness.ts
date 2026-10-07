import { giftFieldErrors } from './checkout-rules';
import type { CheckoutForm } from './checkout-rules';

/** "Sipariş Ver"i durduran ilk eksik (N1); sayfa sirasiyla. */
export type OrderBlocker = 'closed' | 'minBasket' | 'gift' | 'card' | 'address' | 'agreement';

export interface ReadinessInput {
  readonly form: CheckoutForm;
  readonly cardId: string | undefined;
  readonly hasAddress: boolean;
  /** @getir/pricing: minimum sepet tuttu mu (kurallar gelmediyse false). */
  readonly canCheckout: boolean;
  readonly marketOpen: boolean;
}

/**
 * Siparis verilebilir mi (T12.4; N1): market acik, minimum sepet tutuyor,
 * hediye alanlari hatasiz, gecerli kart secili, hesap adresi secili (M7),
 * sozlesmeler onayli. Ilk eksik doner; hepsi tamamsa undefined. Dugmenin
 * pasifligi ve istegin hemen oncesindeki son denetim (QA N3) AYNI fonksiyon.
 */
export function orderBlocker({
  form,
  cardId,
  hasAddress,
  canCheckout,
  marketOpen,
}: ReadinessInput): OrderBlocker | undefined {
  if (!marketOpen) return 'closed';
  if (!canCheckout) return 'minBasket';
  if (Object.keys(giftFieldErrors(form.gift)).length > 0) return 'gift';
  if (cardId === undefined) return 'card';
  if (!hasAddress) return 'address';
  if (!form.agreementsAccepted) return 'agreement';
  return undefined;
}
