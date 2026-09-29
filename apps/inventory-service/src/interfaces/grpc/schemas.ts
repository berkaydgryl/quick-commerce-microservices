/**
 * gRPC istek semalari (Zod; ADR-10).
 *
 * Market kimligi sozlesmenin bicimindedir (@getir/contracts). SKU listesi en
 * fazla MAX_AVAILABILITY_SKUS; bos SKU reddedilir. SKU BICIMI BILEREK ESNEK:
 * bicimi bozuk ama dolu SKU reddedilmez, `unknownSkus`'ta doner - toplu
 * okumada tek hatali kalem butun listeyi dusurmemeli (catalog BatchGetOffers
 * ile ayni kural). Bos liste gecerlidir (bos cevap).
 *
 * dark_store_id (ADR-15 oncesi alan) okunmaz: servis yeni, eski istemcisi yok.
 */

import { marketIdSchema } from '@getir/contracts';
import { z } from 'zod';

import { MAX_AVAILABILITY_SKUS } from '../../config/constants.js';

/** Bos olamayan metin (proto3'te eksik alan "" gelir). */
const requiredText = z.string({ required_error: 'zorunlu' }).trim().min(1, 'zorunlu');

export const checkAvailabilityRequestSchema = z.object({
  marketId: requiredText.pipe(marketIdSchema),
  skus: z.array(requiredText).max(MAX_AVAILABILITY_SKUS, `en fazla ${MAX_AVAILABILITY_SKUS} sku`),
});
