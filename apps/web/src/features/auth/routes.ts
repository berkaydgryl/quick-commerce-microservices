/** Kimlik ekranlarinin adresleri (T8.5). */
export const AUTH_ROUTES = {
  login: '/giris',
  register: '/kayit',
  account: '/hesabim',
} as const;

/** Giristen ya da kayittan sonra donulecek adresi tasiyan sorgu parametresi. */
export const NEXT_PARAM = 'next';
