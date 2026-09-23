import type { Category } from '@getir/contracts';

import styles from './MarketCatalog.module.css';

interface MarketCategoryFilterProps {
  readonly categories: readonly Category[];
  /** undefined: "Tumu" secili. */
  readonly selectedId: string | undefined;
  readonly onSelect: (categoryId: string | undefined) => void;
}

/** Kategori filtresi - TASARIMSIZ KABUK (T5.4). Secim durumu aria-pressed ile duyurulur. */
export function MarketCategoryFilter({
  categories,
  selectedId,
  onSelect,
}: MarketCategoryFilterProps) {
  const options = [{ id: undefined, name: 'Tümü' }, ...categories];

  return (
    <div className={styles['c-market-catalog__filters']} role="group" aria-label="Kategoriler">
      {options.map((option) => (
        <button
          key={option.id ?? 'tumu'}
          type="button"
          className={styles['c-market-catalog__filter']}
          aria-pressed={option.id === selectedId}
          onClick={() => onSelect(option.id)}
        >
          {option.name}
        </button>
      ))}
    </div>
  );
}
