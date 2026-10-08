/**
 * UpdateCardNickname use-case (#148): kayitli kartin YALNIZCA adini degistirir;
 * numara, son kullanma ve CVV degismez (yeni kart icin sil + ekle).
 *
 * Ad kurallari (NFC + kirpma, uzunluk, 8+ ardisik rakam yasagi) istek
 * semasindadir (@getir/contracts updateCardNicknameRequestSchema); buraya
 * normallesmis ad gelir. null ACIKCA kaldirir: alani unutan cagiran adi silemez.
 *
 * Kart yok, baskasinin ya da silinmisse NOT_FOUND: uc durum disaridan ayirt
 * edilemez (baskasinin kart kimligi yoklanamaz). Suresi gecmis kartin adi da
 * degisir. Kart adi KISISEL VERIDIR: gunlukte yalnizca kimlikler.
 */

import type { Logger } from '@getir/core';

import { isNicknameRemoval } from '../domain/card.js';
import type { Card } from '../domain/card.js';
import { cardNotFound } from '../domain/card-errors.js';
import type { CardRepository } from '../domain/card-repository.js';

export interface UpdateCardNicknameDeps {
  readonly repository: Pick<CardRepository, 'updateNickname'>;
}

export interface UpdateCardNicknameInput {
  readonly userId: string;
  readonly cardId: string;
  /** Normallesmis ad; null = adi kaldir (zorunlu alan, eksik birakilamaz). */
  readonly nickname: string | null;
}

export type UpdateCardNickname = (input: UpdateCardNicknameInput, logger: Logger) => Promise<Card>;

export function createUpdateCardNickname(deps: UpdateCardNicknameDeps): UpdateCardNickname {
  return async ({ userId, cardId, nickname }, logger) => {
    const updated = await deps.repository.updateNickname(userId, cardId, nickname);
    if (updated === null) {
      throw cardNotFound(cardId);
    }
    logger.info({ userId, cardId, removed: isNicknameRemoval(nickname) }, 'kart adi guncellendi');
    return updated;
  };
}
