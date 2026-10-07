import type { OrderPaymentView, OrdersContent } from '@getir/contracts';

export type PaymentLabelTexts = Pick<
  OrdersContent,
  'paymentCardLabel' | 'paymentCashLabel' | 'paymentPosLabel'
>;

/**
 * Siparisin odeme satiri (F12): "Kart", "Kapıda nakit" ya da "Kapıda kredi/banka
 * kartı". Odeme secimi olmayan eski sipariste undefined (satir cizilmez). Onay
 * ekrani (F17) da ayni biçimleyiciyi kullanir.
 */
export function paymentLabel(
  payment: OrderPaymentView | undefined,
  texts: PaymentLabelTexts,
): string | undefined {
  if (payment === undefined) {
    return undefined;
  }
  if (payment.method === 'CARD') {
    return texts.paymentCardLabel;
  }
  return payment.onDelivery === 'POS' ? texts.paymentPosLabel : texts.paymentCashLabel;
}
