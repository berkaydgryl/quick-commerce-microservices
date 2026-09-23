import type { Category } from '../../domain/catalog.js';
import type { CategoryReader } from '../../domain/category-reader.js';

export class InMemoryCategoryReader implements CategoryReader {
  private readonly categories: readonly Category[];

  constructor(categories: readonly Category[]) {
    this.categories = categories;
  }

  listCategories(): Promise<readonly Category[]> {
    return Promise.resolve(this.categories);
  }
}
