/** Katalog sorgu anahtarlari tek yerde: gecersiz kilma (invalidate) ayni diziyi kullanir. */
export const catalogKeys = {
  all: ['catalog'] as const,
  categories: () => [...catalogKeys.all, 'categories'] as const,
};
