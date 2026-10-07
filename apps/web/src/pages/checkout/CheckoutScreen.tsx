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

import { useAddressBook } from '../../features/address/hooks/useAddressBook';
import { selectedAddress } from '../../features/address/services/delivery-address';
import { DeliveryAddressSection } from '../../features/address/ui/DeliveryAddressSection';
import { useCartTotals } from '../../features/cart/hooks/useCartTotals';
import { CART_PATH } from '../../features/cart/routes';
import { useCartStore } from '../../features/cart/stores/useCartStore';
import { useCheckoutForm } from '../../features/checkout/hooks/useCheckoutForm';
import { useCheckoutOrder } from '../../features/checkout/hooks/useCheckoutOrder';
import { useMethodDialog } from '../../features/checkout/hooks/useMethodDialog';
import { useSelectedCard } from '../../features/checkout/hooks/useSelectedCard';
import { giftFieldErrors } from '../../features/checkout/services/checkout-rules';
import type { GiftFieldErrors } from '../../features/checkout/services/checkout-rules';
import { DeliveryMethodSection } from '../../features/checkout/ui/DeliveryMethodSection';
import { GiftSection } from '../../features/checkout/ui/GiftSection';
import { NoteSection } from '../../features/checkout/ui/NoteSection';
import { OrderSummaryCard } from '../../features/checkout/ui/OrderSummaryCard';
import { PaymentMethodDialog } from '../../features/checkout/ui/PaymentMethodDialog';
import { PaymentMethodView } from '../../features/checkout/ui/PaymentMethodView';
import { ReservationStatus } from '../../features/checkout/ui/ReservationStatus';
import { ThreeDsStep } from '../../features/checkout/ui/ThreeDsStep';
import { useSessionStore } from '../../shared/session/session-store';
import { QueryError } from '../../shared/ui/query-status/QueryStatus';

import styles from './CheckoutPage.module.css';

interface CheckoutScreenProps {
  readonly texts: CheckoutContent;
  readonly cartPage: CartPageContent;
  readonly list: MarketListContent;
  readonly cardTexts: PaymentMethodsContent;
  /** Adres formunun metinleri; icerik ucu hata verirse yok (adres karti cizilmez). */
  readonly setup: AddressSetupContent | undefined;
  /** Sepetin marketi; yuklenene kadar teslimat bolumu yok, siparis verilemez. */
  readonly market: Market | undefined;
}

/**
 * Odeme sayfasinin govdesi (T17.1; T12.4 siparis akisi): solda Hediye
 * Bilgileri, Teslimat Yöntemi, Not Ekle ve Ödeme Yöntemi; sagda adres ve Ödeme
 * Özeti; 3DS gerekirse pencere. "Değiştir" ve "Kart ekle" odeme yontemi
 * penceresini acar (F5; yalnizca kasa acik pakette: production'da pencere
 * pakete girmez). Formun hatalari alan terk edilince gorunur.
 * Sepet bossa sepet sayfasina doner (siparis tamamlanip sepet bosaldiysa
 * donmez: sipariş detayina gidiliyor).
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
  const userId = useSessionStore((state) => state.user?.id ?? '');
  const totals = useCartTotals();
  const checkout = useCheckoutForm();
  const selected = useSelectedCard(userId);
  const { delivery, addresses } = useAddressBook();
  const order = useCheckoutOrder({
    form: checkout.form,
    card: selected.card,
    address: selectedAddress(addresses, delivery),
    market,
    items,
    totals,
    texts,
  });
  const [touched, setTouched] = useState<ReadonlySet<keyof GiftFieldErrors>>(new Set());
  const methods = useMethodDialog();
  const { state } = order.flow;
  const canPickCard = __CARD_VAULT__ && state.kind === 'idle';

  if (items.length === 0 && state.kind !== 'done') {
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
        <PaymentMethodView
          loading={selected.loading}
          problem={
            selected.error === null ? undefined : (
              <QueryError error={selected.error} onRetry={selected.retry} />
            )
          }
          card={selected.card}
          texts={texts}
          cardTexts={cardTexts}
          onChange={canPickCard ? () => methods.open('list') : undefined}
          onAdd={canPickCard ? () => methods.open('add') : undefined}
          actionRef={methods.actionRef}
        />
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
          blocker={order.blockerText}
          busy={state.kind !== 'idle'}
          status={
            <ReservationStatus
              phase={order.flow.reservation.phase}
              texts={texts}
              onRetry={order.flow.reservation.retry}
            />
          }
          onPlace={order.place}
        />
      </div>
      {__CARD_VAULT__ && methods.start !== null && (
        <PaymentMethodDialog
          userId={userId}
          appliedId={selected.card?.id}
          start={methods.start}
          texts={texts}
          cardTexts={cardTexts}
          onChoose={(cardId) => {
            selected.choose(cardId);
            methods.close();
          }}
          onClose={methods.close}
        />
      )}
      {state.kind === 'challenge' && (
        <ThreeDsStep
          deadline={state.deadline}
          verifying={state.verifying}
          failure={state.failure}
          texts={texts}
          onSubmit={(otp) => void order.flow.submit(otp)}
          onCancel={order.flow.cancel}
          onExpire={order.flow.expire}
        />
      )}
    </div>
  );
}
