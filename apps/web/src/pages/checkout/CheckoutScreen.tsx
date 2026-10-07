import type {
  AddressSetupContent,
  CartPageContent,
  CheckoutContent,
  Market,
  MarketListContent,
  PaymentMethodsContent,
} from '@getir/contracts';
import { useState } from 'react';
import { Navigate } from 'react-router-dom';

import { DeliveryAddressSection } from '../../features/address/ui/DeliveryAddressSection';
import { useCartTotals } from '../../features/cart/hooks/useCartTotals';
import { CART_PATH } from '../../features/cart/routes';
import { useCartStore } from '../../features/cart/stores/useCartStore';
import { useCheckoutForm } from '../../features/checkout/hooks/useCheckoutForm';
import { giftFieldErrors } from '../../features/checkout/services/checkout-rules';
import type { GiftFieldErrors } from '../../features/checkout/services/checkout-rules';
import { DeliveryMethodSection } from '../../features/checkout/ui/DeliveryMethodSection';
import { GiftSection } from '../../features/checkout/ui/GiftSection';
import { NoteSection } from '../../features/checkout/ui/NoteSection';
import { OrderSummaryCard } from '../../features/checkout/ui/OrderSummaryCard';
import { PaymentMethodSection } from '../../features/checkout/ui/PaymentMethodSection';
import { useSessionStore } from '../../shared/session/session-store';

import styles from './CheckoutPage.module.css';

interface CheckoutScreenProps {
  readonly texts: CheckoutContent;
  readonly cartPage: CartPageContent;
  readonly list: MarketListContent;
  readonly cardTexts: PaymentMethodsContent;
  /** Adres formunun metinleri; icerik ucu hata verirse yok (adres karti cizilmez). */
  readonly setup: AddressSetupContent | undefined;
  /** Sepetin marketi; yuklenene kadar teslimat bolumu yok. */
  readonly market: Market | undefined;
}

/**
 * Odeme sayfasinin govdesi (T17.1): solda Hediye Bilgileri, Teslimat Yöntemi,
 * Not Ekle ve Ödeme Yöntemi; sagda adres ve Ödeme Özeti. Formun hatalari alan
 * terk edilince gorunur. Siparis akisi (rezervasyon, siparis, 3DS) F4b'de;
 * burada "Sipariş Ver" pasif. Sepet bossa sepet sayfasina doner.
 */
export function CheckoutScreen({
  texts,
  cartPage,
  list,
  cardTexts,
  setup,
  market,
}: CheckoutScreenProps) {
  const items = useCartStore((cart) => cart.items);
  const userId = useSessionStore((state) => state.user?.id);
  const totals = useCartTotals();
  const checkout = useCheckoutForm();
  const [touched, setTouched] = useState<ReadonlySet<keyof GiftFieldErrors>>(new Set());

  if (items.length === 0) {
    return <Navigate to={CART_PATH} replace />;
  }
  const errors = giftFieldErrors(checkout.form.gift);
  const shown: GiftFieldErrors = Object.fromEntries(
    Object.entries(errors).filter(([field]) => touched.has(field as keyof GiftFieldErrors)),
  );

  return (
    <div className={styles['c-checkout']}>
      <h1 className={styles['c-checkout__title']}>{texts.title}</h1>
      <div className={styles['c-checkout__main']}>
        <GiftSection
          gift={checkout.form.gift}
          errors={shown}
          texts={texts}
          onChange={checkout.setGift}
          onBlur={(field) => setTouched((current) => new Set(current).add(field))}
        />
        {market !== undefined && (
          <DeliveryMethodSection market={market} totals={totals} texts={texts} listTexts={list} />
        )}
        <NoteSection
          note={checkout.form.note}
          doNotRingBell={checkout.form.doNotRingBell}
          texts={texts}
          onNoteChange={checkout.setNote}
          onDoNotRingBellChange={checkout.setDoNotRingBell}
        />
        {userId !== undefined && (
          <PaymentMethodSection userId={userId} texts={texts} cardTexts={cardTexts} />
        )}
      </div>
      <div className={styles['c-checkout__side']}>
        {setup !== undefined && (
          <DeliveryAddressSection
            texts={{
              title: cartPage.addressTitle,
              noAddressNotice: cartPage.noAddressNotice,
              loadingLabel: cartPage.addressLoadingLabel,
            }}
            setup={setup}
          />
        )}
        <OrderSummaryCard
          totals={totals}
          agreementsAccepted={checkout.form.agreementsAccepted}
          onAgreementsChange={checkout.setAgreementsAccepted}
          texts={texts}
        />
      </div>
    </div>
  );
}
