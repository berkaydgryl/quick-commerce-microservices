import { useState } from 'react';

import styles from './CategoryIcon.module.css';

/**
 * Yer: karsilama izgarasi (varsayilan), magaza sayfasinin kategori listesi ve
 * urun karti (T16.2), sepet sayfasinin satiri (T16.3).
 */
export type CategoryIconVariant = 'grid' | 'nav' | 'product' | 'row';

const VARIANT_CLASS = {
  grid: styles['c-category-icon'],
  nav: `${styles['c-category-icon']} ${styles['c-category-icon--nav']}`,
  product: `${styles['c-category-icon']} ${styles['c-category-icon--product']}`,
  row: `${styles['c-category-icon']} ${styles['c-category-icon--row']}`,
} as const;

interface CategoryIconProps {
  readonly name: string;
  readonly imageUrl: string | undefined;
  readonly variant?: CategoryIconVariant | undefined;
}

/**
 * Kategori gorseli; gorsel yoksa ya da yuklenemezse adin bas harfi gosterilir.
 * Gorsel adresini gateway kurar (ASSET_BASE_URL); dosya henuz yayinda olmayabilir.
 * Magaza sayfasinda urun kartinin gorseli de budur: urun gorselleri yayinda
 * olmadigindan (B3) urunun kategorisinin gorseli kullanilir (T16.2, K2).
 */
export function CategoryIcon({ name, imageUrl, variant = 'grid' }: CategoryIconProps) {
  const [failed, setFailed] = useState(false);
  const showImage = imageUrl !== undefined && !failed;

  return (
    <span className={VARIANT_CLASS[variant]} aria-hidden="true">
      {showImage ? (
        <img
          className={styles['c-category-icon__image']}
          src={imageUrl}
          alt=""
          loading="lazy"
          onError={() => setFailed(true)}
        />
      ) : (
        <span className={styles['c-category-icon__initial']}>
          {name.charAt(0).toLocaleUpperCase('tr-TR')}
        </span>
      )}
    </span>
  );
}
