import type { SendEmailCodeRequest } from '@getir/contracts';
import { useMutation } from '@tanstack/react-query';

import { createIdempotencyKey } from '../../../shared/api/idempotency-key';
import { authorizedClient } from '../../../shared/session/session';
import { sendEmailCode } from '../api/email.api';

/**
 * Dogrulama kodu gonderme (T11.14): POST /v1/me/email/code.
 *
 * Anahtar GONDERIM basinadir (niyet anahtari degil): basarili gonderimin
 * kaydi 24 saat tekrar edilir; ayni adrese "Kodu yeniden gönder" ayni anahtarla
 * gitseydi yeni ileti yerine eski cevap donerdi. Cift tiklamayi dugme
 * engeller (gonderim surerken basilamaz).
 */
export function useSendEmailCode() {
  return useMutation({
    mutationFn: (request: SendEmailCodeRequest) =>
      sendEmailCode(authorizedClient, request, createIdempotencyKey()),
  });
}
