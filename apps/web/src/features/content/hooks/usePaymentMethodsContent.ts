import { CONTENT_FALLBACK } from '@getir/contracts';
import type { PaymentMethodsContent } from '@getir/contracts';

import { useWelcomeContent } from './useWelcomeContent';

/**
 * Odeme Yontemlerim'in metinleri (T11.17): icerik ucundan; uc hata verirse
 * icerik yedeginden (degerler welcome.json ile ayni, contracts testi
 * denetler). Icerik yuklenirken undefined.
 */
export function usePaymentMethodsContent(): PaymentMethodsContent | undefined {
  const { data, error } = useWelcomeContent();
  if (data !== undefined) {
    return data.paymentMethods;
  }
  return error === null ? undefined : CONTENT_FALLBACK.paymentMethods;
}
