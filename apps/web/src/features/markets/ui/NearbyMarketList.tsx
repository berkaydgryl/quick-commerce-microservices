import type { NearbyMarket } from '@getir/contracts';

import styles from './Markets.module.css';
import { NearbyMarketLine } from './NearbyMarketLine';

/**
 * Yakindaki marketler listesi - TASARIMSIZ KABUK (T5.4). Yalnizca veriyi
 * okunur sirayla gosterir; kart tasarimi kullanicinindir (T16.2).
 */
export function NearbyMarketList({ markets }: { readonly markets: readonly NearbyMarket[] }) {
  return (
    <ul className={styles['c-market-list']} role="list">
      {markets.map((nearby) => (
        <li
          key={nearby.market.id}
          className={`${styles['c-market-list__item']} ${nearby.market.isOpen ? '' : styles['is-closed']}`}
        >
          <NearbyMarketLine nearby={nearby} />
        </li>
      ))}
    </ul>
  );
}
