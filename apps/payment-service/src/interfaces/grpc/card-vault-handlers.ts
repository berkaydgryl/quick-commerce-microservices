/**
 * CardVaultService gRPC handler'lari (T11.17): AddCard, ListCards, DeleteCard;
 * UpdateCardNickname (#148).
 *
 * Handler dogrular, use-case'i cagirir, cevabi sozlesme bicimine cevirir. Is
 * kurali yok; hata cevirisi ve gunlukleme service-kit'in ara katmanindadir.
 * Istek nesnesi HICBIR YERDE gunluge verilmez: AddCard'da kart numarasi ve
 * CVV, UpdateCardNickname kart adi (kisisel veri) tasir (testli).
 */

import type { Clock, Logger } from '@getir/core';
import type { cardvaultV1 } from '@getir/proto';
import { unaryHandler } from '@getir/service-kit';
import type { UntypedServiceImplementation } from '@grpc/grpc-js';

import type { AddCard } from '../../application/add-card.js';
import type { DeleteCard } from '../../application/delete-card.js';
import type { ListCards } from '../../application/list-cards.js';
import type { UpdateCardNickname } from '../../application/update-card-nickname.js';
import { toProtoSavedCard, toProtoSavedCards } from './card-mappers.js';
import {
  addCardRequestSchema,
  deleteCardRequestSchema,
  listCardsRequestSchema,
  updateCardNicknameRequestSchema,
} from './card-schemas.js';

export interface CardVaultHandlerDeps {
  readonly addCard: AddCard;
  readonly listCards: ListCards;
  readonly deleteCard: DeleteCard;
  readonly updateCardNickname: UpdateCardNickname;
  /** Cevaptaki `expired` alaninin okuma ani. */
  readonly clock: Clock;
  readonly logger?: Logger;
}

export function createCardVaultImplementation(
  deps: CardVaultHandlerDeps,
): UntypedServiceImplementation {
  const logger = deps.logger;

  return {
    addCard: unaryHandler({
      name: 'AddCard',
      schema: addCardRequestSchema,
      ...(logger === undefined ? {} : { logger }),
      handle: async (input, ctx): Promise<cardvaultV1.AddCardResponse> => ({
        card: toProtoSavedCard(await deps.addCard(input, ctx.logger), deps.clock.date()),
      }),
    }),

    listCards: unaryHandler({
      name: 'ListCards',
      schema: listCardsRequestSchema,
      ...(logger === undefined ? {} : { logger }),
      handle: async (input): Promise<cardvaultV1.ListCardsResponse> => ({
        cards: toProtoSavedCards(await deps.listCards(input.userId), deps.clock.date()),
      }),
    }),

    deleteCard: unaryHandler({
      name: 'DeleteCard',
      schema: deleteCardRequestSchema,
      ...(logger === undefined ? {} : { logger }),
      handle: async (input, ctx): Promise<cardvaultV1.DeleteCardResponse> => ({
        cards: toProtoSavedCards(await deps.deleteCard(input, ctx.logger), deps.clock.date()),
      }),
    }),

    updateCardNickname: unaryHandler({
      name: 'UpdateCardNickname',
      schema: updateCardNicknameRequestSchema,
      ...(logger === undefined ? {} : { logger }),
      handle: async (
        { userId, cardId, nickname },
        ctx,
      ): Promise<cardvaultV1.UpdateCardNicknameResponse> => {
        // Semada bos ad cikista undefined: kaldirma burada ACIK null olur.
        const input = { userId, cardId, nickname: nickname ?? null };
        return {
          card: toProtoSavedCard(
            await deps.updateCardNickname(input, ctx.logger),
            deps.clock.date(),
          ),
        };
      },
    }),
  };
}
