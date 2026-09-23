/**
 * Siparis gecmisi imlecinin TEL bicimi: opak sayfa jetonu <-> imlec.
 *
 * Sozlesme (getir.common.v1.PageRequest.page_token): "Opak deger: bicimi
 * sunucuya aittir ve haber verilmeden degisebilir." Icerik base64url'dir,
 * sifreleme degildir; gizli bilgi tasimaz (yalnizca zaman ve siparis kimligi,
 * ikisi de kullanicinin kendi siparisine aittir).
 */

import type { OrderHistoryCursor } from '../../domain/order-history-cursor.js';

const SEPARATOR = '.';
const EPOCH_MS_PATTERN = /^\d+$/;

export function encodePageToken(cursor: OrderHistoryCursor): string {
  const raw = `${cursor.createdAt.getTime()}${SEPARATOR}${cursor.orderId}`;
  return Buffer.from(raw, 'utf8').toString('base64url');
}

/**
 * Jetonu cozer. Bu sunucunun urettigi bicimde degilse null (cagiran taraf
 * dogrulama hatasina cevirir). Bos jeton burada gelmez: "ilk sayfa" anlamini
 * sema verir.
 */
export function decodePageToken(token: string): OrderHistoryCursor | null {
  const raw = Buffer.from(token, 'base64url').toString('utf8');
  const separatorAt = raw.indexOf(SEPARATOR);
  const epochMs = raw.slice(0, separatorAt);
  const orderId = raw.slice(separatorAt + 1);

  if (separatorAt <= 0 || orderId === '' || !EPOCH_MS_PATTERN.test(epochMs)) {
    return null;
  }
  return { createdAt: new Date(Number(epochMs)), orderId };
}
