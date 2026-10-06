/**
 * ListCards use-case (T11.17): kullanicinin silinmemis kartlari, yeniden
 * eskiye. Liste sinirlidir (SAVED_CARDS_MAX), sayfalanmaz.
 */

import type { Card } from '../domain/card.js';
import type { CardRepository } from '../domain/card-repository.js';

export interface ListCardsDeps {
  readonly repository: Pick<CardRepository, 'listActive'>;
}

export type ListCards = (userId: string) => Promise<readonly Card[]>;

export function createListCards(deps: ListCardsDeps): ListCards {
  return (userId) => deps.repository.listActive(userId);
}
