/**
 * Kart kasasinin gRPC istek semalari (T11.17). Kart kurallari @getir/contracts
 * addCardRequestSchema'dadir (web ve gateway ayni semayi kullanir); burada
 * yalnizca gateway'in verdigi kullanici kimligi eklenir.
 *
 * Proto3'te gonderilmeyen alan bos metin ya da 0 gelir: bos kart adi "kart adi
 * yok", 0 ay ve yil kendi cumlesiyle reddedilir. Cumleler DEGERI YANKILAMAZ.
 */

import { addCardRequestSchema as addCardBodySchema } from '@getir/contracts';
import { z } from 'zod';

import { requiredText } from './schemas.js';

/** user_id gateway'den gelir (erisim jetonunun sub'i); servis alana guvenir. */
const userIdSchema = z.object({ userId: requiredText('userId') });

export const addCardRequestSchema = userIdSchema.and(addCardBodySchema);

export type AddCardRequestInput = z.infer<typeof addCardRequestSchema>;

export const listCardsRequestSchema = userIdSchema;

/**
 * Kart kimliginin BICIMI denetlenmez: bicim disi kimlikli kart da "yok"tur
 * (NOT_FOUND); yoklayan kimligin bicimini ogrenemez.
 */
export const deleteCardRequestSchema = userIdSchema.extend({ cardId: requiredText('cardId') });
