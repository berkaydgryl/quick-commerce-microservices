import { QueryEmpty, QueryError } from '../../../shared/ui/query-status/QueryStatus';
import { CATEGORY_SKELETON_COUNT } from '../constants';
import { useCategories } from '../hooks/useCategories';

import styles from './CategorySection.module.css';
import { CategoryStrip, CategoryStripSkeleton } from './CategoryStrip';

/** Kategori bolumu: sorgu durumuna gore iskelet, hata, bos ya da serit. */
export function CategorySection() {
  const { data: categories, error, isPending, refetch } = useCategories();

  return (
    <section
      className={styles['c-category-section']}
      aria-labelledby="kategoriler-baslik"
      aria-busy={isPending}
    >
      <h2 id="kategoriler-baslik" className={styles['c-category-section__title']}>
        Kategoriler
      </h2>

      {isPending && <CategoryStripSkeleton count={CATEGORY_SKELETON_COUNT} />}

      {error !== null && <QueryError error={error} onRetry={() => void refetch()} />}

      {categories !== undefined && categories.length === 0 && (
        <QueryEmpty>Henüz kategori yok.</QueryEmpty>
      )}

      {categories !== undefined && categories.length > 0 && (
        <CategoryStrip categories={categories} />
      )}
    </section>
  );
}
