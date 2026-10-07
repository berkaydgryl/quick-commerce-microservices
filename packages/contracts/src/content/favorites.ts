/**
 * Favori marketler (T11.13; R1, D18: content.ts'ten tasindi).
 */

import { z } from 'zod';

import { contentTextSchema } from './content-text.js';

/**
 * Favori marketler (T11.13; referans getircarsi "Favori Isletmelerim"):
 * kartlardaki kalp, profil sayfasinin menusu ve favori sayfasi. Hata
 * bildirimleri (toast) de buradan: kalp tiklamasi sunucuda basarisiz olursa
 * kalp eski haline doner ve bildirim cikar.
 */
export const favoritesContentSchema = z.object({
  /** Favori sayfasinin basligi: "Favori İşletmelerim". */
  title: contentTextSchema,
  /** Kalbin erisilebilir adi: favori degilken / favoriyken. */
  addLabel: contentTextSchema,
  removeLabel: contentTextSchema,
  loadingLabel: contentTextSchema,
  emptyTitle: contentTextSchema,
  emptyHint: contentTextSchema,
  /** Favori sayfasinda kart kaldirilinca ekran okuyucu duyurusu: "Moda Kasabı favorilerden çıkarıldı". */
  removedNotice: contentTextSchema,
  updateFailedToast: contentTextSchema,
  /** Liste FAVORITE_MARKETS_MAX'a ulasti. */
  listFullToast: contentTextSchema,
  toastDismissLabel: contentTextSchema,
});

export type FavoritesContent = z.infer<typeof favoritesContentSchema>;
