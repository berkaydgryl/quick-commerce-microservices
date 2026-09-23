import { useParams, useSearchParams } from 'react-router-dom';

import { MarketCatalogSection } from '../../features/catalog/ui/MarketCatalogSection';
import { useMarket } from '../../features/markets/hooks/useMarket';
import { MarketSummarySection } from '../../features/markets/ui/MarketSummarySection';
import { PageLayout } from '../../shared/ui/page-layout/PageLayout';

import styles from './MarketPage.module.css';

/** Secili kategori adreste durur: yenileme ve paylasma secimi korur. */
const CATEGORY_PARAM = 'kategori';

/** /markets/:marketId - market basligi ve katalogu. */
export function MarketPage() {
  const { marketId = '' } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const categoryId = searchParams.get(CATEGORY_PARAM) ?? undefined;
  // Ayni sorgu anahtari: ek istek yok, basligin sorgusunu paylasir. Market
  // bulunamazsa hata YALNIZCA baslikta gorunur; katalog ayni hatayi iki kez
  // daha soylemez. Katalog istekleri yine paralel baslar (bekleme eklenmez).
  const marketFailed = useMarket(marketId).isError;

  const selectCategory = (next: string | undefined): void => {
    setSearchParams(next === undefined ? {} : { [CATEGORY_PARAM]: next }, { replace: true });
  };

  return (
    <PageLayout>
      <div className={styles['c-market-page']}>
        <MarketSummarySection marketId={marketId} />
        {!marketFailed && (
          <MarketCatalogSection
            marketId={marketId}
            categoryId={categoryId}
            onCategoryChange={selectCategory}
          />
        )}
      </div>
    </PageLayout>
  );
}
