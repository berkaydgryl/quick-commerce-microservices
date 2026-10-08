/**
 * Kart kasasinin gRPC istek semalari (T11.17). Kart kurallari @getir/contracts
 * addCardRequestSchema'dadir (web ve gateway ayni semayi kullanir); burada
 * yalnizca gateway'in verdigi kullanici kimligi eklenir.
 *
 * Proto3'te gonderilmeyen duz alan bos metin ya da 0 gelir: AddCard'da bos kart
 * adi "kart adi yok", 0 ay ve yil kendi cumlesiyle reddedilir. UpdateCardNickname'in
 * ad alani optional'dir: gonderilmeyen ad bos metin degil EKSIK gelir. Cumleler
 * DEGERI YANKILAMAZ.
 */

import {
  addCardRequestSchema as addCardBodySchema,
  updateCardNicknameRequestSchema as updateCardNicknameBodySchema,
} from '@getir/contracts';
import { z } from 'zod';

import { requiredText } from './schemas.js';

/** user_id gateway'den gelir (erisim jetonunun sub'i); servis alana guvenir. */
const userIdSchema = z.object({ userId: requiredText('userId') });

export const addCardRequestSchema = userIdSchema.and(addCardBodySchema);

export const listCardsRequestSchema = userIdSchema;

/**
 * Kart kimliginin BICIMI denetlenmez: bicim disi kimlikli kart da "yok"tur
 * (NOT_FOUND); yoklayan kimligin bicimini ogrenemez.
 */
export const deleteCardRequestSchema = userIdSchema.extend({ cardId: requiredText('cardId') });

/**
 * Kart adi duzenleme (#148): ad kurallari contracts semasinda. HTTP govdesi
 * orada SIKI (bilinmeyen alan reddedilir, gateway 400); burada ATILIR: cozulmus
 * proto mesajina ileride eklenen alan istegi dusurmesin. Proto alani optional:
 * eksik ad kasaya kadar eksik gelir ve "Kart adı gönderilmedi" ile reddedilir;
 * bos metin adi kaldirir. Kart kimliginin bicimi silmedeki gibi denetlenmez
 * (yoksa NOT_FOUND).
 */
export const updateCardNicknameRequestSchema = updateCardNicknameBodySchema.strip().extend({
  userId: requiredText('userId'),
  cardId: requiredText('cardId'),
});
