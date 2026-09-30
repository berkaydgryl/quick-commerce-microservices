/** Katalog sorgu anahtarlari tek yerde: gecersiz kilma (invalidate) ayni diziyi kullanir. */
export const catalogKeys = {
  all: ['catalog'] as const,
  categories: () => [...catalogKeys.all, 'categories'] as const,
  marketCategories: (marketId: string) =>
    [...catalogKeys.all, 'market', marketId, 'categories'] as const,
  /**
   * Kategori ya da arama yoksa null: "tum urunler", "kategori X" ve "arama Y"
   * ayri onbellek girdileridir (T9.5).
   */
  marketProducts: (marketId: string, categoryId: string | undefined, query?: string) =>
    [
      ...catalogKeys.all,
      'market',
      marketId,
      'products',
      categoryId ?? null,
      query ?? null,
    ] as const,
};
