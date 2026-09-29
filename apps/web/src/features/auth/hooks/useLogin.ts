import type { LoginRequest } from '@getir/contracts';
import { useMutation } from '@tanstack/react-query';

import { apiClient } from '../../../shared/api/client';
import { sessionLock } from '../../../shared/session/session';
import { useSessionStore } from '../../../shared/session/session-store';
import { loginUser } from '../api/auth.api';

/**
 * Giris (T8.5): basarili cevap oturumu bu sekmede acar. Istek oturum kilidi
 * altindadir: acilistaki sessiz yenileme bitmeden cevabi ezilmez
 * (shared/session/session-lock.ts).
 */
export function useLogin() {
  const signIn = useSessionStore((state) => state.signIn);
  return useMutation({
    mutationFn: (request: LoginRequest) => sessionLock(() => loginUser(apiClient, request)),
    onSuccess: (session) => signIn(session),
  });
}
