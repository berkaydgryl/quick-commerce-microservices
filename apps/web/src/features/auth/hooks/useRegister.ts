import type { RegisterRequest } from '@getir/contracts';
import { useMutation } from '@tanstack/react-query';

import { apiClient } from '../../../shared/api/client';
import { createIdempotencyKey } from '../../../shared/api/idempotency-key';
import { sessionLock } from '../../../shared/session/session';
import { useSessionStore } from '../../../shared/session/session-store';
import { registerUser } from '../api/auth.api';

/**
 * Kayit (T8.5): hesap acar ve oturumu baslatir.
 *
 * Idempotency-Key HER GONDERIMDE yenidir. Kayit cevabi saklanmaz (ADR-08 eki):
 * bitmis kaydin tekrari uca gecer ve PHONE_ALREADY_REGISTERED alir, ikinci hesap
 * acilmaz. Anahtari formun omru boyunca tutmak ise numarayi duzeltip yeniden
 * gonderen kullaniciya parmak izi cakismasi (409 CONFLICT) gosterirdi. Cift
 * tiklamayi gonderim sirasinda kapanan dugme onler.
 */
export function useRegister() {
  const signIn = useSessionStore((state) => state.signIn);
  return useMutation({
    mutationFn: (request: RegisterRequest) =>
      sessionLock(() => registerUser(apiClient, request, createIdempotencyKey())),
    onSuccess: (session) => signIn(session),
  });
}
