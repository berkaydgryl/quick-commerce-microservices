/**
 * Siparis detayinin yoklama araligi (F21, PM S3: 10 sn; demo surelerinde
 * hazirlik ~30 sn, yol ~2 dk). Siparis son durumda degilken detay bu
 * aralikla yeniden istenir; siparis bitince ya da sekme gizliyken durur.
 * Genel hiz sinirinin (dakikada 120) icinde: dakikada 6 istek. T13.4 web
 * soketi gelince kaldirilir.
 */
export const ORDER_TRACK_POLL_MS = 10_000;
