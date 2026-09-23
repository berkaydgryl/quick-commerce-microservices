import { CategorySection } from '../../features/catalog/ui/CategorySection';
import { PageLayout } from '../../shared/ui/page-layout/PageLayout';

/** Ilk ekran: logo ve kategori seridi. */
export function HomePage() {
  return (
    <PageLayout brandIsTitle>
      <CategorySection />
    </PageLayout>
  );
}
