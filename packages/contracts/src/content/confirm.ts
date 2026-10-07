import { z } from 'zod';

import { contentTextSchema } from './content-text.js';

/**
 * Ortak onay penceresi (F13; 07.10 kullanici istegi, referans #57): butun silme
 * onaylari ayni pencere; ortada tek soru, altta solda "Hayır", sagda "Evet".
 * Soru silinen seye gore ekranin kendi blogunda (sepet, kart, adres); dugmeler
 * burada bir kez.
 */
export const confirmContentSchema = z.object({
  yesLabel: contentTextSchema,
  noLabel: contentTextSchema,
});

export type ConfirmContent = z.infer<typeof confirmContentSchema>;
