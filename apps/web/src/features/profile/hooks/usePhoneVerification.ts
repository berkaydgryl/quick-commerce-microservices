import type { SendPhoneCodeRequest, VerifyPhoneRequest } from '@getir/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import { createIdempotencyKey } from '../../../shared/api/idempotency-key';
import { authorizedClient } from '../../../shared/session/session';
import { authKeys } from '../../auth/api/query-keys';
import { sendPhoneCode, verifyPhone } from '../api/profile.api';

/**
 * Telefon kodu gonderme (T11.14 PR 3). Anahtar GONDERIM basinadir: "Kodu
 * yeniden gönder" yeni SMS istemeli (e-postadaki kuralla ayni).
 */
export function useSendPhoneCode() {
  return useMutation({
    mutationFn: (request: SendPhoneCodeRequest) =>
      sendPhoneCode(authorizedClient, request, createIdempotencyKey()),
  });
}

/** Telefon kodunu dogrulama: cevap guncel profil, onbellege yazilir. */
export function useVerifyPhone(userId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (request: VerifyPhoneRequest) =>
      verifyPhone(authorizedClient, request, createIdempotencyKey()),
    onSuccess: (profile) => {
      queryClient.setQueryData(authKeys.profile(userId), profile);
    },
  });
}
