/** Katalog sorgu anahtarlari tek yerde: gecersiz kilma (invalidate) ayni diziyi kullanir. */
export const catalogKeys = {
  all: ['catalog'] as const,
  categories: () => [...catalogKeys.all, 'categories'] as const,
  marketCategories: (marketId: string) =>
    [...catalogKeys.all, 'market', marketId, 'categories'] as const,
  /** Kategori yoksa null: "tum urunler" ile "kategori X" ayri onbellek girdileridir. */
  marketProducts: (marketId: string, categoryId: string | undefined) =>
    [...catalogKeys.all, 'market', marketId, 'products', categoryId ?? null] as const,
};
