/** Kimlik ekranlarinin adresleri (T8.5; T11.6). */
export const AUTH_ROUTES = {
  /** Karsilama ekrani: oturumsuz ziyaretcinin ana sayfasi (T11.6). */
  welcome: '/',
  login: '/giris',
  register: '/kayit',
  account: '/hesabim',
} as const;

/** Giristen ya da kayittan sonra donulecek adresi tasiyan sorgu parametresi. */
export const NEXT_PARAM = 'next';
