import { z } from 'zod';

import { contentTextSchema } from './content-text.js';

/**
 * Tam ekran Yukleniyor gostergesi (F18): dairenin altinda harf harf yazilan
 * yazi. Gosterge icerik gelmeden de gorunur (yedekten); logonun iki parcasi
 * header blogundan (brand, service).
 */
export const appLoadingContentSchema = z.object({
  label: contentTextSchema,
});

export type AppLoadingContent = z.infer<typeof appLoadingContentSchema>;
