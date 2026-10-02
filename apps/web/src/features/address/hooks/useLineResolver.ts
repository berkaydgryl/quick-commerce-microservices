import type { GeoPoint } from '@getir/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import { authorizedClient } from '../../../shared/session/session';
import { reverseGeocodeQuery } from '../api/queries';
import { resolvedLine, unresolvedLine } from '../services/line-notice';
import type { ResolvedLine } from '../services/line-notice';

/**
 * "Bu adresi kullan" (T11.8): pinin oldugu noktanin adres satiri. Sorgu
 * onbellegi uzerinden (ayni nokta tekrar sorulmaz); bekleme durumu dugmede
 * gorunsun diye mutasyon olarak calisir. HICBIR ZAMAN hata firlatmaz: adres
 * bulunamazsa da satir bos ve uyariyla doner (line-notice.ts).
 */
export function useLineResolver(unresolvedNotice: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (point: GeoPoint): Promise<ResolvedLine> => {
      try {
        const result = await queryClient.fetchQuery(reverseGeocodeQuery(authorizedClient, point));
        return resolvedLine(result.line);
      } catch (error) {
        return unresolvedLine(error, unresolvedNotice);
      }
    },
  });
}
