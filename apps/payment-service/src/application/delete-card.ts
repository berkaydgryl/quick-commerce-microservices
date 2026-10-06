/**
 * DeleteCard use-case (T11.17): karti yumusak siler, guncel listeyi doner.
 *
 * Kart yok, baska kullanicinin ya da zaten silinmisse NOT_FOUND: uc durum
 * disaridan ayirt edilemez (baskasinin kart kimligi yoklanamaz). Silinen
 * kartin saglayici jetonu kayitta kalmaz; gecmis odemeler karta bagli degildir.
 *
 * Liste silmeden ONCE okunur, silinen kart ondan cikarilir (QA D5): silme
 * yapildiktan sonra okuma duserse silme basarisiz gorunmez (istemci yeniden
 * denese NOT_FOUND alirdi). Okuma ile silme arasina giren ekleme bu cevapta
 * gorunmeyebilir; sonraki liste onu gosterir.
 */

import type { Clock, Logger } from '@getir/core';

import type { Card } from '../domain/card.js';
import { cardNotFound } from '../domain/card-errors.js';
import type { CardRepository } from '../domain/card-repository.js';

export interface DeleteCardDeps {
  readonly repository: Pick<CardRepository, 'softDelete' | 'listActive'>;
  readonly clock: Clock;
}

export interface DeleteCardInput {
  readonly userId: string;
  readonly cardId: string;
}

export type DeleteCard = (input: DeleteCardInput, logger: Logger) => Promise<readonly Card[]>;

export function createDeleteCard(deps: DeleteCardDeps): DeleteCard {
  return async ({ userId, cardId }, logger) => {
    const before = await deps.repository.listActive(userId);
    const deleted = await deps.repository.softDelete(userId, cardId, deps.clock.date());
    if (!deleted) {
      throw cardNotFound(cardId);
    }
    logger.info({ userId, cardId }, 'kart silindi');
    return before.filter((card) => card.id !== cardId);
  };
}
