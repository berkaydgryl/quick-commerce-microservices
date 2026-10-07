import type { Category } from '@getir/contracts';
import { useId } from 'react';

import { ChevronRightIcon } from '../../cart/ui/icons';

import { CategoryIcon } from './CategoryIcon';
import { GridIcon } from './icons';
import styles from './MarketCategoryNav.module.css';

interface MarketCategoryNavProps {
  readonly categories: readonly Category[];
  /** undefined: "Tumu" secili. */
  readonly selectedId: string | undefined;
  readonly onSelect: (categoryId: string | undefined) => void;
  /** "Kategoriler" ve "Tümü": market listesiyle ortak metinler (marketList). */
  readonly texts: { readonly title: string; readonly allLabel: string };
}

/**
 * Magaza sayfasinin kategorileri (T16.2; referans getircarsi "Kategoriler"):
 * genis ekranda solda dikey liste (gorsel, ad, ok; secili satir mor zeminli),
 * dar ekranda yatay kayan serit. Katalog duz listedir, alt kategori yok (B3):
 * akordeonun acilan duzeyi yoktur. Secim aria-pressed ile duyurulur.
 */
export function MarketCategoryNav({
  categories,
  selectedId,
  onSelect,
  texts,
}: MarketCategoryNavProps) {
  const titleId = useId();
  const options = [{ id: undefined, name: texts.allLabel }, ...categories];

  return (
    <nav className={styles['c-category-nav']} aria-labelledby={titleId}>
      <h2 id={titleId} className={styles['c-category-nav__title']}>
        {texts.title}
      </h2>
      <ul className={styles['c-category-nav__list']} role="list">
        {options.map((option) => (
          <li key={option.id ?? 'tumu'}>
            <button
              type="button"
              className={styles['c-category-nav__item']}
              aria-pressed={option.id === selectedId}
              onClick={() => onSelect(option.id)}
            >
              {option.id === undefined ? (
                <span className={styles['c-category-nav__all-icon']} aria-hidden="true">
                  <GridIcon />
                </span>
              ) : (
                <CategoryIcon name={option.name} imageUrl={option.imageUrl} variant="nav" />
              )}
              <span className={styles['c-category-nav__name']}>{option.name}</span>
              <span className={styles['c-category-nav__chevron']} aria-hidden="true">
                <ChevronRightIcon />
              </span>
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}
