/**
 * Siparis onay ekrani (F17; /siparis/:id/onay): "Sipariş Ver"den sonra acilir.
 * Baslik siparis verildiyse "Siparişin alındı!", risk incelemesindeyse
 * "Siparişin inceleniyor" ve kisa not; altinda takip cizgisi, ozet, teslimat
 * ayrintilari (varsa), urunler ve tutarlar; iki dugme. Diger etiketler
 * orders, checkout, paymentMethods (kart markalari) ve cartPage
 * (deliveryTimeLabel: "Tahmini varış süresi") bloklarindan.
 */

import { z } from 'zod';

import { contentTextSchema } from './content-text.js';

export const orderConfirmationContentSchema = z.object({
  placedTitle: contentTextSchema,
  reviewTitle: contentTextSchema,
  reviewNotice: contentTextSchema,
  summaryTitle: contentTextSchema,
  detailsTitle: contentTextSchema,
  ordersLinkLabel: contentTextSchema,
  continueLabel: contentTextSchema,
});

export type OrderConfirmationContent = z.infer<typeof orderConfirmationContentSchema>;
