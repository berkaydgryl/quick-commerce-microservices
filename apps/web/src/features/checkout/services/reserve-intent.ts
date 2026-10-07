import type { ReserveCartRequest } from '@getir/contracts';

import { createIdempotencyKey, createIntentKeys } from '../../../shared/api/idempotency-key';

/**
 * Rezervasyonun niyet anahtari (T12.4; QA K9 F1 duzeltmesi). Ayni niyet
 * (ayni sepet + adres + tutar) ayni Idempotency-Key ile gider: sonucu belirsiz
 * istek (ag, 503, REQUEST_IN_PROGRESS) tekrarlaninca sunucu AYNI rezervasyonu
 * doner. Sonuc KESIN bitince (basari, odeme reddi ve diger kesin 4xx'ler,
 * rezervasyonun birakilmasi: Vazgeç, sure, hak) niyet de biter: renew ile yeni
 * anahtar. Yoksa ayni govdeli bir sonraki deneme gateway'in idempotency
 * kaydindan iptal edilmis eski rezervasyonu alir ve siparis 409 ile duser.
 */
export interface ReserveIntent {
  readonly key: (request: ReserveCartRequest) => string;
  /** Sonuc kesin bitti: sonraki rezervasyon yeni anahtarla. */
  readonly renew: () => void;
}

export function createReserveIntent(create: () => string = createIdempotencyKey): ReserveIntent {
  let keys = createIntentKeys(create);
  return {
    key: (request) => keys(request),
    renew: () => {
      keys = createIntentKeys(create);
    },
  };
}
