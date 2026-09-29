/**
 * Giristen ya da kayittan sonra donulecek adres (?next=; T8.5).
 *
 * Yalnizca bu uygulamanin ICINDEKI bir yol kabul edilir. "//kotu.site",
 * "/\\kotu.site" ya da mutlak adres baska bir siteye gonderirdi (acik
 * yonlendirme); adres URL olarak cozulur ve kaynagi degisiyorsa reddedilir.
 * Giris ve kayit ekranina donulmez (dongu). Gecersizse ana sayfa.
 */

import { AUTH_ROUTES, NEXT_PARAM } from '../routes';

export const HOME_PATH = '/';

/** Goreli yolu cozmek icin kullanilan, hicbir yere gitmeyen kaynak. */
const PARSE_ORIGIN = 'https://uygulama.invalid';

const NO_RETURN_PATHS: ReadonlySet<string> = new Set([AUTH_ROUTES.login, AUTH_ROUTES.register]);

export function safeNextPath(raw: string | null): string {
  if (raw === null || !raw.startsWith('/')) {
    return HOME_PATH;
  }
  let url: URL;
  try {
    url = new URL(raw, PARSE_ORIGIN);
  } catch {
    return HOME_PATH;
  }
  if (url.origin !== PARSE_ORIGIN || NO_RETURN_PATHS.has(url.pathname)) {
    return HOME_PATH;
  }
  return `${url.pathname}${url.search}${url.hash}`;
}

/** Donus adresini tasiyan kimlik ekrani adresi: ("/giris", "/markets") -> "/giris?next=%2Fmarkets". */
export function withNextPath(authPath: string, next: string): string {
  if (next === HOME_PATH) {
    return authPath;
  }
  return `${authPath}?${new URLSearchParams({ [NEXT_PARAM]: next }).toString()}`;
}

/** Su anki sayfaya donen giris adresi (korumali sayfa, basliktaki "Giris yap"). */
export function loginPathFor(location: {
  readonly pathname: string;
  readonly search: string;
}): string {
  return withNextPath(AUTH_ROUTES.login, safeNextPath(`${location.pathname}${location.search}`));
}
