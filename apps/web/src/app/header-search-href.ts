/**
 * Ust bar aramasinin gidecegi adres (T11.10 duzeltmesi, QA B2): SAF kural.
 *
 * Sonuclar ana sayfadadir (`/?ara=`). Oturumsuz ziyaretcinin ana sayfasi
 * karsilama ekranidir; oraya gitseydi arama sessizce kaybolurdu. Bu yuzden
 * oturumsuz ziyaretci giris ekranina gider, donus adresi arama sonuclaridir
 * (mevcut `?next=` kalibi): girince aramasina doner.
 */

import { AUTH_ROUTES } from '../features/auth/routes';
import { withNextPath } from '../features/auth/services/next-path';
import { searchHref } from '../features/search/services/search-route';
import type { SessionStatus } from '../shared/session/session-store';

export function headerSearchHref(session: SessionStatus, query: string): string {
  const results = searchHref(query);
  return session === 'authenticated' ? results : withNextPath(AUTH_ROUTES.login, results);
}
