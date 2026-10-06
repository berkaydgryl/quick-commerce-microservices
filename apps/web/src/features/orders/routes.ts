/** Gecmis Siparislerim'in adresi (T11.16): profil sayfasinin alt sayfasi. */
export const ORDERS_PATH = '/hesabim/siparislerim';

/** Siparis detayinin rota deseni (router); baglanti icin orderPath. */
export const ORDER_DETAIL_ROUTE = `${ORDERS_PATH}/:orderId`;

/** Siparis detayinin adresi: kimlik yolda (bicimi ord_ + hex; yine de kodlanir). */
export function orderPath(orderId: string): string {
  return `${ORDERS_PATH}/${encodeURIComponent(orderId)}`;
}
