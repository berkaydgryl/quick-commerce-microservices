/**
 * Use-case: vitrinde gosterilecek kategori listesi.
 * Bir dosya = bir use-case = bir public fonksiyon.
 */

import { MAX_CATEGORY_COUNT } from '../config/constants.js';
import type { Category } from '../domain/catalog.js';
import { sortCategories } from '../domain/catalog.js';
import type { CategoryReader } from '../domain/category-reader.js';

export interface ListCategoriesDeps {
  readonly categories: CategoryReader;
}

export type ListCategories = () => Promise<readonly Category[]>;

/**
 * Siralama BURADA degil domain'de: ayni kural yarin admin yuzeyinde de
 * gecerli olacak ve use-case kopyalanmadan yeniden kullanilabilsin.
 */
export function createListCategories(deps: ListCategoriesDeps): ListCategories {
  return async () => sortCategories(await deps.categories.listCategories(MAX_CATEGORY_COUNT));
}
