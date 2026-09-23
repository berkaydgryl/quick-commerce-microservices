import { useState } from 'react';

import styles from './CategoryStrip.module.css';

interface CategoryIconProps {
  readonly name: string;
  readonly imageUrl: string | undefined;
}

/**
 * Kategori gorseli; gorsel yoksa ya da yuklenemezse adin bas harfi gosterilir.
 * Gorsel adresini gateway kurar (ASSET_BASE_URL); dosya henuz yayinda olmayabilir.
 */
export function CategoryIcon({ name, imageUrl }: CategoryIconProps) {
  const [failed, setFailed] = useState(false);
  const showImage = imageUrl !== undefined && !failed;

  return (
    <span className={styles['c-category-strip__icon']} aria-hidden="true">
      {showImage ? (
        <img
          className={styles['c-category-strip__image']}
          src={imageUrl}
          alt=""
          loading="lazy"
          onError={() => setFailed(true)}
        />
      ) : (
        <span className={styles['c-category-strip__initial']}>
          {name.charAt(0).toLocaleUpperCase('tr-TR')}
        </span>
      )}
    </span>
  );
}
