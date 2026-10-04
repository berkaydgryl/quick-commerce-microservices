import type { FavoritesContent, Market } from '@getir/contracts';

import { useSessionStore } from '../../../shared/session/session-store';
import { useFavorites } from '../hooks/useFavorites';
import { useToggleFavorite } from '../hooks/useToggleFavorite';
import { favoriteIdsOf } from '../services/favorite-list';

import styles from './FavoriteButton.module.css';
import { HeartIcon } from './icons';

interface FavoriteButtonProps {
  readonly market: Market;
  readonly texts: FavoritesContent;
}

/**
 * Kalp (T11.13; referans getircarsi): kart kapaginin sag ust kosesinde.
 * Favori degilken beyaz cizgi, ici bos; favoriyken beyaz cizgi, ici marka
 * moru. Basinca iyimser degisir (useToggleFavorite). Oturum yoksa cizilmez;
 * favoriler okunana kadar basilamaz (yanlis durumu tersine cevirmesin).
 */
export function FavoriteButton({ market, texts }: FavoriteButtonProps) {
  const status = useSessionStore((state) => state.status);
  const favorites = useFavorites();
  const toggle = useToggleFavorite(market, texts);

  if (status !== 'authenticated') {
    return null;
  }
  const favorite = favoriteIdsOf(favorites.data).has(market.id);
  return (
    <FavoriteButtonView
      favorite={favorite}
      label={favorite ? texts.removeLabel : texts.addLabel}
      disabled={favorites.data === undefined}
      onToggle={() => toggle.mutate(!favorite)}
    />
  );
}

interface FavoriteButtonViewProps {
  readonly favorite: boolean;
  readonly label: string;
  readonly disabled: boolean;
  readonly onToggle: () => void;
}

/** Kalbin gorunumu: durum aria-pressed ile duyurulur, adi duruma gore degisir. */
export function FavoriteButtonView({
  favorite,
  label,
  disabled,
  onToggle,
}: FavoriteButtonViewProps) {
  return (
    <button
      type="button"
      className={favorite ? `${styles['c-favorite']} ${styles['is-active']}` : styles['c-favorite']}
      aria-pressed={favorite}
      aria-label={label}
      disabled={disabled}
      onClick={onToggle}
    >
      <span className={styles['c-favorite__icon']}>
        <HeartIcon />
      </span>
    </button>
  );
}
