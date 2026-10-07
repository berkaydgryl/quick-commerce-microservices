import { useState } from 'react';

import { EMPTY_CHECKOUT_FORM } from '../services/checkout-rules';
import type { CheckoutForm, GiftForm } from '../services/checkout-rules';

/**
 * Odeme formunun durumu (T17.1). Kisisel veri (alici adi ve telefonu, notlar)
 * YALNIZCA bu durumda yasar: depoya, onbellege ve adrese yazilmaz; sayfadan
 * cikinca kaybolur. Hediye kapatilinca alanlar silinmez (yanlislikla kapatan
 * yeniden acinca yazdiklarini bulur) ama gonderilmez.
 */
export function useCheckoutForm() {
  const [form, setForm] = useState<CheckoutForm>(EMPTY_CHECKOUT_FORM);
  return {
    form,
    setGift: (patch: Partial<GiftForm>) =>
      setForm((current) => ({ ...current, gift: { ...current.gift, ...patch } })),
    setNote: (note: string) => setForm((current) => ({ ...current, note })),
    setDoNotRingBell: (doNotRingBell: boolean) =>
      setForm((current) => ({ ...current, doNotRingBell })),
    setAgreementsAccepted: (agreementsAccepted: boolean) =>
      setForm((current) => ({ ...current, agreementsAccepted })),
  };
}
