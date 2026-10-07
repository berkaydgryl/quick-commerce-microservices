import { CONTENT_FALLBACK } from '@getir/contracts';
import type { CourierTrackingContent } from '@getir/contracts';

import { contentFailed, useWelcomeContent } from './useWelcomeContent';

/**
 * Kurye penceresi ve yaklasma bildiriminin metinleri (F22): icerik ucundan;
 * uc hata verirse (bir kez hatadan sonra kalici) icerik yedeginden. Icerik
 * yuklenirken undefined.
 */
export function useCourierTrackingContent(): CourierTrackingContent | undefined {
  const query = useWelcomeContent();
  if (query.data !== undefined) {
    return query.data.courierTracking;
  }
  return contentFailed(query) ? CONTENT_FALLBACK.courierTracking : undefined;
}
