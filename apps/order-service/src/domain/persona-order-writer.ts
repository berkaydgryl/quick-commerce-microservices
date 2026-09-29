/**
 * Persona siparis gecmisini yazan port (seed, T8.1).
 */

import type { Order } from './order.js';

export interface PersonaOrderWriter {
  /**
   * Verilen kullanicilarin ESKI siparislerini siler ve `orders`'i yazar; iki
   * adim birlikte basarir ya da birlikte geri alinir. Olay YAZILMAZ: gecmis
   * siparis bugun olmus gibi yayinlanmamali (outbox bos kalir).
   */
  replaceForUsers(userIds: readonly string[], orders: readonly Order[]): Promise<void>;
}
