import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

import { apiClient } from '../../../shared/api/client';
import { checkPhone } from '../api/auth.api';
import { authKeys } from '../api/query-keys';
import { PHONE_CHECK_DEBOUNCE_MS, PHONE_CHECK_STALE_TIME_MS } from '../constants';

/**
 * Numarayla kayitli hesap var mi (T11.7; sunucu verisi -> TanStack Query).
 * phone: tamamlanmis E.164 numara ya da null (form-schemas.ts completePhone).
 * Numara kisa bir beklemeden sonra sorulur; numara degisirse onceki istek
 * iptal edilir (sinyal). Cevap gelene kadar ya da hata olursa undefined:
 * uyari gosterilmez, form her zamanki gibi calisir (sunucu kaydi yine denetler).
 */
export function usePhoneRegistration(phone: string | null): boolean | undefined {
  const [settled, setSettled] = useState<string | null>(null);

  useEffect(() => {
    if (phone === null) {
      setSettled(null);
      return undefined;
    }
    const timer = setTimeout(() => setSettled(phone), PHONE_CHECK_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [phone]);

  const query = useQuery({
    queryKey: authKeys.phoneCheck(settled ?? ''),
    queryFn: ({ signal }) => checkPhone(apiClient, { phone: settled ?? '' }, signal),
    enabled: settled !== null && settled === phone,
    staleTime: PHONE_CHECK_STALE_TIME_MS,
    select: (result) => result.registered,
  });
  return settled === phone ? query.data : undefined;
}
