import { CONTENT_FALLBACK } from '@getir/contracts';
import type { OrderConfirmationContent } from '@getir/contracts';

import { contentFailed, useWelcomeContent } from './useWelcomeContent';

/**
 * Siparis onay ekraninin metinleri (F17): icerik ucundan; uc hata verirse
 * (bir kez hatadan sonra kalici) icerik yedeginden. Icerik yuklenirken undefined.
 */
export function useOrderConfirmationContent(): OrderConfirmationContent | undefined {
  const query = useWelcomeContent();
  if (query.data !== undefined) {
    return query.data.orderConfirmation;
  }
  return contentFailed(query) ? CONTENT_FALLBACK.orderConfirmation : undefined;
}
