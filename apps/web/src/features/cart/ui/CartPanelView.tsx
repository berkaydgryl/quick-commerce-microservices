import type { MarketListCartContent } from '@getir/contracts';
import { CURRENCY } from '@getir/core';
import type { CartTotals } from '@getir/pricing';
import { useId } from 'react';
import { Link } from 'react-router-dom';

import { formatMoney } from '../../../shared/services/format';
import { TrashIcon } from '../../address/ui/icons';
import type { CartItem, CartMarket } from '../services/cart-state';

import styles from './CartPanel.module.css';
import { CartPanelItem } from './CartPanelItem';
import { BagIcon, StoreIcon } from './icons';

const money = (amountMinor: number) => formatMoney({ amountMinor, currency: CURRENCY });

export interface CartPanelViewProps {
  readonly texts: MarketListCartContent;
  readonly market: CartMarket | null;
  readonly items: readonly CartItem[];
  /** Sepetin marketinin kurallariyla toplam; kurallar gelene kadar undefined. */
  readonly totals: CartTotals | undefined;
  /** Magaza adinin baglantisi: sepetin marketinin sayfasi. */
  readonly marketHref: string | undefined;
  /** "Sepete git"in hedefi. */
  readonly cartHref: string | undefined;
  /** "Sepetim" basligi gorunur mu (market listesinde evet; magaza sayfasinda ekran okuyucuya kalir). */
  readonly titleVisible?: boolean | undefined;
  /**
   * Sepetin marketi kapali (07.10): minimum sepet notunun yerinde "Market şu an
   * kapalı"; "Sepete git" AKTIF kalir (/sepet "Ödemeye Geç"i durdurur; PM S3).
   */
  readonly closed?: boolean | undefined;
  /** Kalemden bir adet daha eklenebilir mi (cart-state canIncrement). */
  readonly canIncrement: (offerId: string) => boolean;
  readonly onIncrement: (offerId: string) => void;
  readonly onDecrement: (offerId: string) => void;
  readonly onRemove: (offerId: string) => void;
  /** Cop kutusu: bosaltma onayini acar (bosaltmaz). */
  readonly onAskClear: () => void;
}

/**
 * Sepetim paneli (T16.3; referans getircarsi): sari cerceveli kart. Bossa
 * canta ikonu ve "Sepetin şu an boş". Doluysa ustte magaza ikonu ve adi
 * (magazaya gider) ile cop kutusu (onayla bosaltir); satirlarda ad, mor tutar
 * ve adet kutusu; altinda "Teslimat Ücreti" (esik gecildiyse "Ücretsiz"; F15),
 * minimum sepete kalan varsa notu; altta "Sepete git" ve TOPLAM (teslimat
 * dahil; telefon cubugu ve odeme sayfasiyla ayni sayi). Hesap @getir/pricing
 * ve cart-state'tedir; bilesen durumsuzdur.
 */
export function CartPanelView({
  texts,
  market,
  items,
  totals,
  marketHref,
  cartHref,
  titleVisible = true,
  closed = false,
  canIncrement,
  onIncrement,
  onDecrement,
  onRemove,
  onAskClear,
}: CartPanelViewProps) {
  const titleId = useId();
  const empty = market === null || items.length === 0;

  return (
    <section className={styles['c-cart-panel']} aria-labelledby={titleId}>
      <h2
        id={titleId}
        className={
          titleVisible ? styles['c-cart-panel__title'] : styles['c-cart-panel__title--hidden']
        }
      >
        {texts.title}
      </h2>
      <div className={styles['c-cart-panel__card']}>
        {empty ? (
          <div className={styles['c-cart-panel__empty']}>
            <span className={styles['c-cart-panel__empty-icon']}>
              <BagIcon />
            </span>
            <div>
              <p className={styles['c-cart-panel__empty-title']}>{texts.emptyTitle}</p>
              <p className={styles['c-cart-panel__empty-hint']}>{texts.emptyHint}</p>
            </div>
          </div>
        ) : (
          <>
            <div className={styles['c-cart-panel__store']}>
              <span className={styles['c-cart-panel__store-icon']} aria-hidden="true">
                <StoreIcon />
              </span>
              {marketHref === undefined ? (
                <span className={styles['c-cart-panel__store-name']}>{market.name}</span>
              ) : (
                <Link to={marketHref} className={styles['c-cart-panel__store-name']}>
                  {market.name}
                </Link>
              )}
              <button
                type="button"
                className={styles['c-cart-panel__clear']}
                aria-label={texts.clearLabel}
                onClick={onAskClear}
              >
                <TrashIcon />
              </button>
            </div>
            <ul className={styles['c-cart-panel__items']} role="list">
              {items.map((item) => (
                <CartPanelItem
                  key={item.offerId}
                  item={item}
                  texts={texts}
                  canIncrement={canIncrement(item.offerId)}
                  onIncrement={() => onIncrement(item.offerId)}
                  onDecrement={() => onDecrement(item.offerId)}
                  onRemove={() => onRemove(item.offerId)}
                />
              ))}
            </ul>
            {totals !== undefined && (
              <p className={styles['c-cart-panel__fee']}>
                <span>{texts.deliveryLabel}</span>
                <span className={styles['c-cart-panel__amount']}>
                  {totals.deliveryFeeMinor === 0
                    ? texts.freeDeliveryLabel
                    : money(totals.deliveryFeeMinor)}
                </span>
              </p>
            )}
            {closed && <p className={styles['c-cart-panel__notice']}>{texts.closedNotice}</p>}
            {!closed && totals !== undefined && !totals.canCheckout && (
              <p className={styles['c-cart-panel__notice']}>
                {texts.minBasketRemainingLabel}:{' '}
                <span className={styles['c-cart-panel__amount']}>
                  {money(totals.amountToMinBasketMinor)}
                </span>
              </p>
            )}
            {cartHref !== undefined && (
              <Link to={cartHref} className={styles['c-cart-panel__go']}>
                <span className={styles['c-cart-panel__go-label']}>{texts.goToCartLabel}</span>
                {totals !== undefined && (
                  <span className={styles['c-cart-panel__go-amount']}>
                    {money(totals.totalMinor)}
                  </span>
                )}
              </Link>
            )}
          </>
        )}
      </div>
    </section>
  );
}
