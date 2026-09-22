/**
 * Seed'in ihtiyaci olan "koleksiyonu bastan yaz" islemi.
 *
 * mongo-kit'in tabanina degil buraya konuldu: toplu silme is verisinde tehlikeli
 * bir islemdir ve yalnizca seed kullanir. Tabana eklenseydi her servisin her
 * repository'sinde "hepsini sil" metodu hazir dururdu.
 */

import type { BaseDocument, SessionOption } from '@getir/mongo-kit';
import { MongoRepository } from '@getir/mongo-kit';
import type { OptionalUnlessRequiredId } from 'mongodb';

export abstract class ReplaceableRepository<
  TDoc extends BaseDocument,
> extends MongoRepository<TDoc> {
  /** Koleksiyonu verilen belgelerle degistirir. Transaction icinde cagrilmalidir. */
  async replaceAll(
    documents: readonly OptionalUnlessRequiredId<TDoc>[],
    options: SessionOption = {},
  ): Promise<void> {
    const session = options.session === undefined ? {} : { session: options.session };

    await this.run('replaceAll.delete', () => this.collection.deleteMany({}, session));
    if (documents.length === 0) {
      // insertMany bos diziyle hata firlatir.
      return;
    }
    await this.run('replaceAll.insert', () => this.collection.insertMany([...documents], session));
  }
}
