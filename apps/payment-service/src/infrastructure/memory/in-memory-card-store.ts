/**
 * Kart kasasinin bellek deposu (T11.17): MOCK modu ve birim testleri icin.
 * Mongo uygulamasinin kurallarini birebir taklit eder (ayni sozlesme testi):
 * kasa siniri, kullanicinin kasasinda ayni kart, yumusak silme. Ekleme tek
 * esli adimdir; es zamanli cagrilar araya giremez.
 */

import { CARD_STATUS, cardKeyOf, deletedCard, isSameCard } from '../../domain/card.js';
import type { Card } from '../../domain/card.js';
import { cardAlreadySaved, cardWalletFull } from '../../domain/card-errors.js';
import type { CardRepository } from '../../domain/card-repository.js';

export class InMemoryCardStore implements CardRepository {
  /** Kart kimligi -> kart (silinenler de durur). */
  private readonly cards = new Map<string, Card>();

  add(card: Card, limit: number): Promise<void> {
    const active = this.active(card.userId);
    const same = active.find((saved) => isSameCard(saved, cardKeyOf(card)));
    if (same !== undefined) {
      return Promise.reject(cardAlreadySaved(same.id));
    }
    if (active.length >= limit) {
      return Promise.reject(cardWalletFull());
    }
    this.cards.set(card.id, card);
    return Promise.resolve();
  }

  listActive(userId: string): Promise<readonly Card[]> {
    return Promise.resolve(
      this.active(userId).sort(
        (left, right) =>
          right.createdAt.getTime() - left.createdAt.getTime() || compareDesc(left.id, right.id),
      ),
    );
  }

  softDelete(userId: string, cardId: string, at: Date): Promise<boolean> {
    const card = this.cards.get(cardId);
    if (card === undefined || card.userId !== userId || card.status !== CARD_STATUS.ACTIVE) {
      return Promise.resolve(false);
    }
    this.cards.set(cardId, deletedCard(card, at));
    return Promise.resolve(true);
  }

  /** Yalnizca test icin: silinenler dahil kayit (P2/P5 jeton denetimi). */
  stored(cardId: string): Card | undefined {
    return this.cards.get(cardId);
  }

  private active(userId: string): Card[] {
    return [...this.cards.values()].filter(
      (card) => card.userId === userId && card.status === CARD_STATUS.ACTIVE,
    );
  }
}

function compareDesc(left: string, right: string): number {
  if (left === right) {
    return 0;
  }
  return left < right ? 1 : -1;
}
