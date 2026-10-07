import { SavedCardPayment } from './SavedCardPayment';
import { PaymentMethodView } from './PaymentMethodView';
import type { PaymentCardTexts, PaymentMethodTexts } from './PaymentMethodView';

interface PaymentMethodSectionProps {
  readonly userId: string;
  readonly texts: PaymentMethodTexts;
  readonly cardTexts: PaymentCardTexts;
}

/**
 * Odeme Yontemi bolumu (T17.1). Kart kasasi production paketinde kapali
 * (__CARD_VAULT__, K1 (a)): orada kart okunmaz, bolum "Kayıtlı kartın yok"
 * der ve siparis verilemez (kasa acilana kadar). Bayrak sabit katlanir;
 * SavedCardPayment ve kasanin ucu production paketine girmez (paket taramasi).
 */
export function PaymentMethodSection({ userId, texts, cardTexts }: PaymentMethodSectionProps) {
  return __CARD_VAULT__ ? (
    <SavedCardPayment userId={userId} texts={texts} cardTexts={cardTexts} />
  ) : (
    <PaymentMethodView loading={false} card={undefined} texts={texts} cardTexts={cardTexts} />
  );
}
