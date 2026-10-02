/** Icerik sorgu anahtarlari tek yerde. */
export const contentKeys = {
  all: ['content'] as const,
  welcome: () => [...contentKeys.all, 'welcome'] as const,
};
