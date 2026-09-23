import type { Category } from '@getir/contracts';

import { CategoryIcon } from './CategoryIcon';
import styles from './CategoryStrip.module.css';

/** Kategori seridi: yalnizca cizer; veri ve durum CategorySection'dadir. */
export function CategoryStrip({ categories }: { readonly categories: readonly Category[] }) {
  return (
    <ul className={styles['c-category-strip']} role="list">
      {categories.map((category) => (
        <li key={category.id} className={styles['c-category-strip__item']}>
          <CategoryIcon name={category.name} imageUrl={category.imageUrl} />
          <span className={styles['c-category-strip__name']}>{category.name}</span>
        </li>
      ))}
    </ul>
  );
}

/** Yuklenirken ayni yerlesimde bos kutucuklar: icerik gelince sayfa ziplamaz. */
export function CategoryStripSkeleton({ count }: { readonly count: number }) {
  return (
    <ul className={styles['c-category-strip']} role="list" aria-hidden="true">
      {Array.from({ length: count }, (_, index) => (
        <li key={index} className={styles['c-category-strip__item']}>
          <span className={`${styles['c-category-strip__icon']} ${styles['is-loading']}`} />
          <span className={`${styles['c-category-strip__name']} ${styles['is-loading']}`} />
        </li>
      ))}
    </ul>
  );
}
