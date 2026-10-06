/**
 * Kart kasasi deposu portu (T11.17). Mongo'da `cards` ve kullanici basina
 * kart sayaci `card_wallets` (ayni transaction); bellekte MOCK ve testler icin.
 * Iki uygulama ayni sozlesme testinden gecer (test/support/card-store-contract.ts).
 */

import type { Card } from './card.js';

export interface CardRepository {
  /**
   * Karti kullanicinin kasasina ekler; TEK ATOMIK adim. Kasada zaten `limit`
   * kart varsa cardWalletFull, ayni kart (cardKeyOf) kayitliysa
   * cardAlreadySaved (var olan kartin kimligiyle). Es zamanli eklemeler de bu
   * iki kurali asamaz.
   */
  add(card: Card, limit: number): Promise<void>;
  /** Kullanicinin silinmemis kartlari, yeniden eskiye (esit anda kimlik azalan). */
  listActive(userId: string): Promise<readonly Card[]>;
  /**
   * Karti yumusak siler (deletedCard) ve kasada bir yer acar; tek atomik adim.
   * @returns silindi mi? (false: kart yok, baska kullanicinin ya da zaten silinmis)
   */
  softDelete(userId: string, cardId: string, at: Date): Promise<boolean>;
}
