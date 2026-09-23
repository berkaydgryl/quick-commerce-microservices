/**
 * Istemci ortam degiskenleri. import.meta.env YALNIZCA bu dosyada okunur.
 *
 * Vite yalnizca VITE_ onekli degiskenleri pakete koyar ve bunlar tarayicida
 * herkesin gorebilecegi degerlerdir: buraya SIR konmaz.
 */

import { z } from 'zod';

const clientEnvSchema = z.object({
  /**
   * Gateway'in kok adresi. Bos: istekler ayni kaynaga gider (gelistirmede Vite
   * proxy'si, uretimde ayni alan adindaki gateway). Dolu ise mutlak URL olmali.
   */
  VITE_API_BASE_URL: z.union([z.literal(''), z.string().url()]).default(''),
});

export interface ClientEnv {
  readonly apiBaseUrl: string;
}

/** Ham kaynagi dogrular; gecersizse uygulama acilmadan hata firlatir. */
export function parseClientEnv(source: Readonly<Record<string, unknown>>): ClientEnv {
  const result = clientEnvSchema.safeParse(source);
  if (!result.success) {
    const fields = Object.keys(result.error.flatten().fieldErrors).join(', ');
    throw new Error(`Gecersiz istemci ortam degiskeni: ${fields}`);
  }
  return { apiBaseUrl: result.data.VITE_API_BASE_URL.replace(/\/+$/, '') };
}

export const env: ClientEnv = parseClientEnv(import.meta.env);
