import type { ResetPasswordRequest } from '@getir/contracts';
import { useMutation } from '@tanstack/react-query';

import { apiClient } from '../../../shared/api/client';
import { sessionLock } from '../../../shared/session/session';
import { useSessionStore } from '../../../shared/session/session-store';
import { resetPassword } from '../api/auth.api';

/**
 * Sifre yenileme (T11.9): basarili cevap oturumu bu sekmede acar (giris
 * gibi; kullanici dogrudan girer). Istek oturum kilidi altindadir: acilistaki
 * sessiz yenileme bitmeden cevabi ezilmez.
 */
export function useResetPassword() {
  const signIn = useSessionStore((state) => state.signIn);
  return useMutation({
    mutationFn: (request: ResetPasswordRequest) =>
      sessionLock(() => resetPassword(apiClient, request)),
    onSuccess: (session) => signIn(session),
  });
}
