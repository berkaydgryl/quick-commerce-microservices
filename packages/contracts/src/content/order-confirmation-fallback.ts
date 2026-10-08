import type { OrderConfirmationContent } from './order-confirmation.js';

/** Onay ekraninin yedegi (F17): icerik gelmese de siparisin alindigi soylenir. */
export const ORDER_CONFIRMATION_FALLBACK: OrderConfirmationContent = {
  placedTitle: 'Siparişin alındı!',
  reviewTitle: 'Siparişin inceleniyor',
  reviewNotice: 'İnceleme bitince durumunu buradan izleyebilirsin.',
  summaryTitle: 'Sipariş özeti',
  detailsTitle: 'Teslimat ayrıntıları',
  ordersLinkLabel: 'Siparişlerime git',
  continueLabel: 'Alışverişe devam et',
};
