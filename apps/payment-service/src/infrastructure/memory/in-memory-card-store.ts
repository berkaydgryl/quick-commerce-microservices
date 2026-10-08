/**
 * Kart kasasinin bellek deposu (T11.17): MOCK modu ve birim testleri icin.
 * Mongo uygulamasinin kurallarini birebir taklit eder (ayni sozlesme testi):
 * kasa siniri, kullanicinin kasasinda ayni kart, yumusak silme. Ekleme tek
 * esli adimdir; es zamanli cagrilar araya giremez.
 */

import { CARD_STATUS, cardKeyOf, deletedCard, isSameCard, renamedCard } from '../../domain/card.js';
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

  findActive(userId: string, cardId: string): Promise<Card | null> {
    return Promise.resolve(this.ownedActive(userId, cardId));
  }

  softDelete(userId: string, cardId: string, at: Date): Promise<boolean> {
    const card = this.ownedActive(userId, cardId);
    if (card === null) {
      return Promise.resolve(false);
    }
    this.cards.set(cardId, deletedCard(card, at));
    return Promise.resolve(true);
  }

  updateNickname(userId: string, cardId: string, nickname: string | null): Promise<Card | null> {
    const card = this.ownedActive(userId, cardId);
    if (card === null) {
      return Promise.resolve(null);
    }
    const renamed = renamedCard(card, nickname);
    this.cards.set(cardId, renamed);
    return Promise.resolve(renamed);
  }

  /** Yalnizca test icin: silinenler dahil kayit (P2/P5 jeton denetimi). */
  stored(cardId: string): Card | undefined {
    return this.cards.get(cardId);
  }

  /**
   * Kart BU kullanicinin ve silinmemis mi: okuma, silme ve ad duzenleme ayni
   * kosulu kullanir (yok, baskasinin ve silinmis ayirt edilemez).
   */
  private ownedActive(userId: string, cardId: string): Card | null {
    const card = this.cards.get(cardId);
    return card?.userId === userId && card.status === CARD_STATUS.ACTIVE ? card : null;
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
