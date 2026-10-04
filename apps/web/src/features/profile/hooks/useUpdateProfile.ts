import type { UpdateProfileRequest } from '@getir/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import { createIdempotencyKey } from '../../../shared/api/idempotency-key';
import { authorizedClient } from '../../../shared/session/session';
import { authKeys } from '../../auth/api/query-keys';
import { updateProfile } from '../api/profile.api';

/**
 * Ad degistirme (T11.14 PR 3, #89): PATCH /v1/me. Cevap guncel profildir;
 * profil onbellegine yazilir. Her kayit yeni anahtarla (ayni adi yeniden
 * kaydetmek zararsizdir).
 */
export function useUpdateProfile(userId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (request: UpdateProfileRequest) =>
      updateProfile(authorizedClient, request, createIdempotencyKey()),
    onSuccess: (profile) => {
      queryClient.setQueryData(authKeys.profile(userId), profile);
    },
  });
}
