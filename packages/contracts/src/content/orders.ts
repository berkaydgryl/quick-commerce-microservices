/**
 * Gecmis Siparislerim (T11.16; R1, D18: content.ts'ten tasindi).
 */

import { z } from 'zod';

import { contentTextSchema } from './content-text.js';

/**
 * Gecmis Siparislerim (T11.16; /hesabim/siparislerim): liste satiri
 * ("X Market · 500,00 TL · Tamamlandı"), durum gruplari, bos not, "Daha fazla
 * göster" ve detay sayfasinin etiketleri. Durum gruplari: Tamamlandı
 * (DELIVERED), Devam ediyor (rozet), İptal edildi (ucret alinmissa
 * "Ücret iade edildi" ile). Iptal edilen sipariste butun urunler "Teslim
 * edilmedi" (siparis duzeyi, #91).
 */
export const ordersContentSchema = z.object({
  title: contentTextSchema,
  loadingLabel: contentTextSchema,
  emptyNotice: contentTextSchema,
  /** Katalogda adi bulunamayan market. */
  unknownMarketLabel: contentTextSchema,
  completedLabel: contentTextSchema,
  inProgressLabel: contentTextSchema,
  cancelledLabel: contentTextSchema,
  refundedLabel: contentTextSchema,
  notDeliveredLabel: contentTextSchema,
  moreLabel: contentTextSchema,
  loadingMoreLabel: contentTextSchema,
  /** Detay sayfasi. */
  dateLabel: contentTextSchema,
  addressLabel: contentTextSchema,
  /** Odeme satiri (F12): kart, kapida nakit ya da kapida kart (POS); eski sipariste yok. */
  paymentLabel: contentTextSchema,
  paymentCardLabel: contentTextSchema,
  paymentCashLabel: contentTextSchema,
  paymentPosLabel: contentTextSchema,
  itemsTitle: contentTextSchema,
  subtotalLabel: contentTextSchema,
  deliveryFeeLabel: contentTextSchema,
  freeDeliveryLabel: contentTextSchema,
  discountLabel: contentTextSchema,
  totalLabel: contentTextSchema,
});

export type OrdersContent = z.infer<typeof ordersContentSchema>;
