/**
 * Icerik metni (T11.6'dan beri content.ts'teydi; T11.17'de ayrildi): bos
 * olamaz, CONTENT_TEXT_MAX_LENGTH ile sinirli. Ekran bloklarinin hepsi kullanir.
 */

import { z } from 'zod';

import { CONTENT_TEXT_MAX_LENGTH } from '../constants.js';

/** Ekranda gorunen bir metin; bos olamaz. */
export const contentTextSchema = z.string().min(1).max(CONTENT_TEXT_MAX_LENGTH);
