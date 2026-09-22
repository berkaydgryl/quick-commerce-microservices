/**
 * Use-case: vitrinde gosterilecek kategori listesi.
 * Bir dosya = bir use-case = bir public fonksiyon.
 */

import type { CatalogRepository } from '../domain/catalog-repository.js';
import type { Category } from '../domain/catalog.js';
import { sortCategories } from '../domain/catalog.js';

export interface ListCategoriesDeps {
  readonly repository: CatalogRepository;
}

export type ListCategories = () => Promise<readonly Category[]>;

/**
 * Siralama BURADA degil domain'de: ayni kural yarin admin yuzeyinde de
 * gecerli olacak ve use-case kopyalanmadan yeniden kullanilabilsin.
 */
export function createListCategories(deps: ListCategoriesDeps): ListCategories {
  return async () => sortCategories(await deps.repository.listCategories());
}
