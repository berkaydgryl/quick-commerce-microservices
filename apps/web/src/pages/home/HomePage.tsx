import { CategorySection } from '../../features/catalog/ui/CategorySection';
import { Logo } from '../../shared/ui/logo/Logo';
import { PageContainer } from '../../shared/ui/page-container/PageContainer';

import styles from './HomePage.module.css';

/** Ilk ekran: logo ve kategori seridi. */
export function HomePage() {
  return (
    <>
      <header className={styles['c-home__header']}>
        <PageContainer>
          <h1 className={styles['c-home__brand']}>
            <Logo />
          </h1>
        </PageContainer>
      </header>
      <main className={styles['c-home__main']}>
        <PageContainer>
          <CategorySection />
        </PageContainer>
      </main>
    </>
  );
}
