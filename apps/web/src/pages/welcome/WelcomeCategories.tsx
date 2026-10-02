import { useCategories } from '../../features/catalog/hooks/useCategories';
import { CATEGORY_SKELETON_COUNT } from '../../features/catalog/constants';
import { CategoryGrid, CategoryGridSkeleton } from '../../features/catalog/ui/CategoryGrid';
import { PageContainer } from '../../shared/ui/page-container/PageContainer';
import { QueryError } from '../../shared/ui/query-status/QueryStatus';

import styles from './WelcomeCategories.module.css';

interface WelcomeCategoriesProps {
  /** Bolum basligi (icerikten). */
  readonly title: string;
  /** Herhangi bir kategori giris penceresini acar: oturumsuz ziyaretci once giris yapar. */
  readonly onSelect: () => void;
}

/**
 * Karsilama ekraninin kategori bolumu (T11.6): urun kategorileri
 * (/v1/categories), izgarada. Liste bossa bolum hic gorunmez: "kategori yok"
 * metni kodda sabit yazilmasin diye (PRD).
 */
export function WelcomeCategories({ title, onSelect }: WelcomeCategoriesProps) {
  const { data: categories, error, isPending, refetch } = useCategories();

  if (categories !== undefined && categories.length === 0) {
    return null;
  }
  return (
    <section
      className={styles['c-welcome-categories']}
      aria-labelledby="karsilama-kategoriler"
      aria-busy={isPending}
    >
      <PageContainer wide>
        <div className={styles['c-welcome-categories__inner']}>
          <h2 id="karsilama-kategoriler" className={styles['c-welcome-categories__title']}>
            {title}
          </h2>
          {isPending && <CategoryGridSkeleton count={CATEGORY_SKELETON_COUNT} />}
          {error !== null && <QueryError error={error} onRetry={() => void refetch()} />}
          {categories !== undefined && (
            <CategoryGrid categories={categories} onSelect={() => onSelect()} />
          )}
        </div>
      </PageContainer>
    </section>
  );
}
