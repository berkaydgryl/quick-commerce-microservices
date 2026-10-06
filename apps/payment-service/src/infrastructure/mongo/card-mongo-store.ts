/**
 * CardRepository portunun Mongo uygulamasi (T11.17): `cards` ve `card_wallets`
 * ayni transaction'da. Sorgu yazmaz; sorgular cards-collection.ts ve
 * card-wallets-collection.ts'te.
 *
 * Bellek uygulamasiyla ayni sozlesme testinden gecer
 * (test/support/card-store-contract.ts): iki depo ayni hatayi verir.
 */

import { ERROR_CODES, isAppError } from '@getir/core';
import type { MongoConnection } from '@getir/mongo-kit';

import { cardKeyOf } from '../../domain/card.js';
import type { Card } from '../../domain/card.js';
import { cardAlreadySaved, cardWalletFull } from '../../domain/card-errors.js';
import type { CardRepository } from '../../domain/card-repository.js';
import { fromCardDocument, toCardDocument } from './card-mappers.js';
import type { CardWalletsCollection } from './card-wallets-collection.js';
import type { CardsCollection } from './cards-collection.js';

export class CardMongoStore implements CardRepository {
  constructor(
    private readonly cards: CardsCollection,
    private readonly wallets: CardWalletsCollection,
    private readonly transactions: Pick<MongoConnection, 'withTransaction'>,
  ) {}

  /**
   * Tek transaction: ayni kart var mi, kasada yer var mi (sayac), kart. Es
   * zamanli iki ekleme ayni sayac belgesine yazar; kaybeden yeniden denenir ve
   * kazananin kartini gorur. Hata transaction icinde firlatilir: geri alinir.
   */
  async add(card: Card, limit: number): Promise<void> {
    try {
      await this.transactions.withTransaction(async (session) => {
        const same = await this.cards.findActiveByKey(cardKeyOf(card), { session });
        if (same !== null) {
          throw cardAlreadySaved(same._id);
        }
        if (!(await this.wallets.reserve(card.userId, limit, { session }))) {
          throw cardWalletFull();
        }
        await this.cards.insertOne(toCardDocument(card), { session });
      });
    } catch (error: unknown) {
      throw await this.withExistingCard(card, error);
    }
  }

  async listActive(userId: string): Promise<readonly Card[]> {
    return (await this.cards.listActive(userId)).map(fromCardDocument);
  }

  async softDelete(userId: string, cardId: string, at: Date): Promise<boolean> {
    return this.transactions.withTransaction(async (session) => {
      const deleted = await this.cards.softDelete(userId, cardId, at, { session });
      if (deleted) {
        await this.wallets.release(userId, { session });
      }
      return deleted;
    });
  }

  /**
   * Her CONFLICT ayni sozlesme hatasina doner: ayni kart, var olan kartin
   * kimligiyle. Benzersiz indeks ihlalinde (son emniyet) kimlik transaction
   * icinde okunamaz (islem iptal); kart burada, transaction disinda bulunur.
   */
  private async withExistingCard(card: Card, error: unknown): Promise<unknown> {
    if (!isAppError(error) || error.code !== ERROR_CODES.CONFLICT) {
      return error;
    }
    const existing = await this.cards.findActiveByKey(cardKeyOf(card));
    return existing === null ? error : cardAlreadySaved(existing._id);
  }
}
