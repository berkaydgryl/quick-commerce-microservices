import type { VerifyEmailRequest } from '@getir/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import { createIdempotencyKey } from '../../../shared/api/idempotency-key';
import { authorizedClient } from '../../../shared/session/session';
import { authKeys } from '../../auth/api/query-keys';
import { verifyEmail } from '../api/email.api';

/**
 * Kod dogrulama (T11.14): POST /v1/me/email/verify. Cevap guncel profildir;
 * profil onbellegine yazilir (yeniden okunmaz): kart adresi ve yesil onayi
 * hemen gosterir. Yanlis kod 400'dur ve kaydedilmez; her deneme yeni anahtarla.
 */
export function useVerifyEmail(userId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (request: VerifyEmailRequest) =>
      verifyEmail(authorizedClient, request, createIdempotencyKey()),
    onSuccess: (profile) => {
      queryClient.setQueryData(authKeys.profile(userId), profile);
    },
  });
}
