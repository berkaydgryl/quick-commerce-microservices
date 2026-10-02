import type { Category } from '@getir/contracts';

import { CategoryIcon } from './CategoryIcon';
import styles from './CategoryGrid.module.css';

interface CategoryGridProps {
  readonly categories: readonly Category[];
  /** Kategori secilince (karsilama ekrani: giris penceresini acar, T11.6). */
  readonly onSelect: (category: Category) => void;
}

/**
 * Kategori izgarasi (T11.6): her kategori bir dugme. Mobilde 3 sutun, genis
 * ekranda sigdigi kadar. Yalnizca cizer; veri ve durum cagirandadir.
 */
export function CategoryGrid({ categories, onSelect }: CategoryGridProps) {
  return (
    <ul className={styles['c-category-grid']} role="list">
      {categories.map((category) => (
        <li key={category.id}>
          <button
            type="button"
            className={styles['c-category-grid__button']}
            onClick={() => onSelect(category)}
          >
            <CategoryIcon name={category.name} imageUrl={category.imageUrl} />
            <span className={styles['c-category-grid__name']}>{category.name}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

/** Yuklenirken ayni yerlesimde bos kutucuklar: icerik gelince sayfa ziplamaz. */
export function CategoryGridSkeleton({ count }: { readonly count: number }) {
  return (
    <ul className={styles['c-category-grid']} role="list" aria-hidden="true">
      {Array.from({ length: count }, (_, index) => (
        <li key={index} className={styles['c-category-grid__placeholder']}>
          <span
            className={`${styles['c-category-grid__placeholder-icon']} ${styles['is-loading']}`}
          />
          <span
            className={`${styles['c-category-grid__placeholder-name']} ${styles['is-loading']}`}
          />
        </li>
      ))}
    </ul>
  );
}
