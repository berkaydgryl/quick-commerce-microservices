/**
 * Siparis durumunun gosterim grubu (T11.16): Gecmis Siparislerim'de durum
 * makinesinin 13 dugumu uc gruba iner. Saf fonksiyonlar; metin icerikten.
 *
 *   completed  - teslim edildi (DELIVERED)
 *   inProgress - suruyor: odeme ve risk adimlari, hazirlik, yolda (sari rozet)
 *   cancelled  - teslim edilmeyecek: iptal, ret, odeme hatasi, sure doldu (gri)
 *
 * Tablo durum tipinin TAMAMINI anahtar alir: ORDER_STATUS'a dugum eklenirse
 * derleme burada durur, grup sessizce "bilinmiyor" olmaz.
 */

import type { Order, OrderStatus, OrdersContent } from '@getir/contracts';

export type OrderStatusGroup = 'completed' | 'inProgress' | 'cancelled';

const STATUS_GROUP: Readonly<Record<OrderStatus, OrderStatusGroup>> = {
  // Sepet taslagi listede yoktur (gateway gizler); detay adresiyle acilirsa suruyor.
  DRAFT: 'inProgress',
  RISK_CHECK: 'inProgress',
  REVIEW: 'inProgress',
  RESERVED: 'inProgress',
  AWAITING_PAYMENT: 'inProgress',
  PAID: 'inProgress',
  PREPARING: 'inProgress',
  ON_THE_WAY: 'inProgress',
  DELIVERED: 'completed',
  CANCELLED: 'cancelled',
  REJECTED: 'cancelled',
  PAYMENT_FAILED: 'cancelled',
  EXPIRED: 'cancelled',
};

export function statusGroup(status: OrderStatus): OrderStatusGroup {
  return STATUS_GROUP[status];
}

/** Grubun etiketi: "Tamamlandı", "Devam ediyor", "İptal edildi". */
export function statusLabel(texts: OrdersContent, group: OrderStatusGroup): string {
  switch (group) {
    case 'completed':
      return texts.completedLabel;
    case 'inProgress':
      return texts.inProgressLabel;
    case 'cancelled':
      return texts.cancelledLabel;
  }
}

/**
 * Ucreti alinmis siparisin iptali: odeme iade edildi ("İptal edildi · Ücret
 * iade edildi"). Kural gateway'in ozetiyle (orderhistory.Refunded) ayni:
 * durum CANCELLED ve gecmiste PAID. Listede ozetin `refunded` alani tasir;
 * bu fonksiyon tam siparisin (detay) karsiligidir.
 */
export function wasRefunded(order: Pick<Order, 'status' | 'timeline'>): boolean {
  return order.status === 'CANCELLED' && order.timeline.some((entry) => entry.status === 'PAID');
}
