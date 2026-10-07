/**
 * Mutlak gorsel adresi (R1, D18: content.ts'ten ayrildi). Ekran bloklarinin
 * gorselleri kullanir; content.ts bunu DISA ACMAZ (yalnizca bloklarin ici).
 */

import { z } from 'zod';

/** Mutlak gorsel adresi; veri goreli yol saklar, gateway ASSET_BASE_URL ile kurar. */
export const contentImageUrlSchema = z.string().url();
