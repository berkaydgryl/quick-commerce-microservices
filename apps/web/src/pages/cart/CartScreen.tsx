import type {
  AddressSetupContent,
  CartPageContent,
  MarketListContent,
  MarketPageContent,
} from '@getir/contracts';
import { useState } from 'react';
import { Link } from 'react-router-dom';

import { TrashIcon } from '../../features/address/ui/icons';
import { DeliveryAddressSection } from '../../features/address/ui/DeliveryAddressSection';
import { useCartMarketClosed } from '../../features/cart/hooks/useCartMarketClosed';
import { useCartTotals } from '../../features/cart/hooks/useCartTotals';
import { canIncrement } from '../../features/cart/services/cart-state';
import type { CartMarket } from '../../features/cart/services/cart-state';
import { useCartStore } from '../../features/cart/stores/useCartStore';
import { CartItemsCard } from '../../features/cart/ui/CartItemsCard';
import { CartTotalsCard } from '../../features/cart/ui/CartTotalsCard';
import { ClearCartDialog } from '../../features/cart/ui/ClearCartDialog';
import { BagIcon } from '../../features/cart/ui/icons';
import { useMarketCategories } from '../../features/catalog/hooks/useMarketCategories';
import { CategoryIcon } from '../../features/catalog/ui/CategoryIcon';
import { CHECKOUT_PATH } from '../../features/checkout/routes';
import { marketPath } from '../../features/markets/routes';

import styles from './CartPage.module.css';

interface CartScreenProps {
  readonly page: CartPageContent;
  readonly list: MarketListContent;
  /** "Son N adet" rozetinin metinleri (marketPage). */
  readonly marketTexts: MarketPageContent;
  /** Adres formunun metinleri; icerik ucu hata verirse yok (adres karti cizilmez). */
  readonly setup: AddressSetupContent | undefined;
}

/**
 * Sepet sayfasinin govdesi (T16.3): solda "Sepetim", "Sepeti temizle" (onayla;
 * Sepetim panelinin penceresi) ve magaza kutusu; sagda adres ve "Sepet
 * Toplamı". Bos sepette not ve marketlere baglanti. Sayfa BIRLESTIRIR: sepet
 * katalogu (satirin gorseli kategorinin) ve adresi tanimaz.
 */
export function CartScreen({ page, list, marketTexts, setup }: CartScreenProps) {
  const market = useCartStore((cart) => cart.market);
  const items = useCartStore((cart) => cart.items);
  const clear = useCartStore((cart) => cart.clear);
  const totals = useCartTotals();
  const closed = useCartMarketClosed();
  const [confirming, setConfirming] = useState(false);

  if (market === null || items.length === 0) {
    return (
      <div className={styles['c-cart-page__empty']}>
        <h1 className={styles['c-cart-page__title']}>{page.title}</h1>
        <div className={styles['c-cart-page__empty-card']}>
          <span className={styles['c-cart-page__empty-icon']}>
            <BagIcon />
          </span>
          <p className={styles['c-cart-page__empty-title']}>{list.cart.emptyTitle}</p>
          <p>{list.cart.emptyHint}</p>
          <Link to="/markets" className={styles['c-cart-page__browse']}>
            {page.browseMarketsLabel}
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className={styles['c-cart-page']}>
      <div className={styles['c-cart-page__main']}>
        <div className={styles['c-cart-page__head']}>
          <h1 className={styles['c-cart-page__title']}>{page.title}</h1>
          <button
            type="button"
            className={styles['c-cart-page__clear']}
            onClick={() => setConfirming(true)}
          >
            <span className={styles['c-cart-page__clear-icon']} aria-hidden="true">
              <TrashIcon />
            </span>
            {page.clearLabel}
          </button>
        </div>
        <CartItemsSection market={market} list={list} marketTexts={marketTexts} closed={closed} />
      </div>
      <div className={styles['c-cart-page__side']}>
        {setup !== undefined && (
          <DeliveryAddressSection
            texts={{
              title: page.addressTitle,
              noAddressNotice: page.noAddressNotice,
              loadingLabel: page.addressLoadingLabel,
            }}
            setup={setup}
          />
        )}
        <CartTotalsCard
          totals={totals}
          texts={page}
          cartTexts={list.cart}
          checkoutHref={CHECKOUT_PATH}
          closed={closed}
        />
      </div>
      {confirming && (
        <ClearCartDialog
          texts={list.cart}
          onConfirm={() => {
            clear();
            setConfirming(false);
          }}
          onCancel={() => setConfirming(false)}
        />
      )}
    </div>
  );
}

interface CartItemsSectionProps {
  readonly market: CartMarket;
  readonly list: MarketListContent;
  readonly marketTexts: MarketPageContent;
  /** Market kapali (07.10): "+" kapali; "−" ve cop calisir (sepetten cikarabilsin). */
  readonly closed: boolean;
}

/** Magaza kutusu: depoyu ve marketin kategorilerini (satirin gorseli, K2) baglar. */
function CartItemsSection({ market, list, marketTexts, closed }: CartItemsSectionProps) {
  const items = useCartStore((cart) => cart.items);
  const increment = useCartStore((cart) => cart.increment);
  const decrement = useCartStore((cart) => cart.decrement);
  const categories = useMarketCategories(market.id).data;

  return (
    <CartItemsCard
      market={market}
      items={items}
      marketHref={marketPath(market.id)}
      texts={{
        decreaseSuffix: list.cart.decreaseSuffix,
        increaseSuffix: list.cart.increaseSuffix,
        removeSuffix: list.cart.removeSuffix,
        quantitySuffix: list.cart.quantitySuffix,
        lowStockPrefix: marketTexts.lowStockPrefix,
        lowStockSuffix: marketTexts.lowStockSuffix,
      }}
      renderVisual={(item) => {
        const category = categories?.find((candidate) => candidate.id === item.categoryId);
        return (
          <CategoryIcon
            name={category?.name ?? item.name}
            imageUrl={category?.imageUrl}
            variant="row"
          />
        );
      }}
      canIncrement={(offerId) => canIncrement({ market, items }, offerId, closed)}
      onIncrement={increment}
      onDecrement={decrement}
    />
  );
}
