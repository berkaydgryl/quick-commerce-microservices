/**
 * Market ici arama kurali (T9.5): kutudaki metinden sunucuya gidecek sorgu.
 *
 * Bas ve son bosluk kirpilir. Sozlesmenin en kisa uzunlugundan (2) kisa metin
 * ARAMA DEGILDIR (undefined): tek harf sunucuda 400 olurdu; kullanici o an
 * normal listeyi gorur. Ust sinir (64) kutunun maxLength'i ile de korunur;
 * adrese elle yazilmis uzun deger kirpilir ki sunucu reddetmesin.
 */

import { SEARCH_QUERY_MAX_LENGTH, SEARCH_QUERY_MIN_LENGTH } from '@getir/contracts';

export function searchQueryFrom(text: string): string | undefined {
  const query = text.trim().slice(0, SEARCH_QUERY_MAX_LENGTH).trim();
  return query.length < SEARCH_QUERY_MIN_LENGTH ? undefined : query;
}
