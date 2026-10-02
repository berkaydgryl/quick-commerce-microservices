/**
 * Harita adres servisi (T11.8): adres ekleme penceresinde pinin oldugu yerin
 * adres satiri (GET /v1/geo/reverse) ve sokak / posta kodu aramasi (GET
 * /v1/geo/search). Gateway OpenStreetMap'in Nominatim servisine sinirli ve
 * onbellekli gider (kullanim kosulu: saniyede en fazla bir istek); istemci
 * Nominatim'i dogrudan cagirmaz. Oturum ister.
 */

import { z } from 'zod';

import { geoPointSchema, latitudeSchema, longitudeSchema, queryNumberSchema } from './common.js';
import {
  ADDRESS_LINE_MAX_LENGTH,
  GEO_SEARCH_QUERY_MAX_LENGTH,
  GEO_SEARCH_QUERY_MIN_LENGTH,
  GEO_SEARCH_RESULTS_MAX,
} from './constants.js';

/** GET /v1/geo/reverse?lat=&lng= */
export const reverseGeocodeQuerySchema = z.object({
  lat: queryNumberSchema().pipe(latitudeSchema),
  lng: queryNumberSchema().pipe(longitudeSchema),
});

/** Noktanin adres satiri ("Acibadem, Almondhill Sitesi 19C3, 34660 Uskudar/Istanbul, Turkiye"). */
export const reverseGeocodeResultSchema = z.object({
  line: z.string().min(1).max(ADDRESS_LINE_MAX_LENGTH),
});

/** GET /v1/geo/search?q= : sokak, mahalle ya da posta kodu. */
export const geoSearchQuerySchema = z.object({
  q: z
    .string()
    .trim()
    .min(GEO_SEARCH_QUERY_MIN_LENGTH, `Arama en az ${GEO_SEARCH_QUERY_MIN_LENGTH} karakter olmalı`)
    .max(
      GEO_SEARCH_QUERY_MAX_LENGTH,
      `Arama en fazla ${GEO_SEARCH_QUERY_MAX_LENGTH} karakter olabilir`,
    ),
});

/** Arama sonucu: adres satiri ve konumu (harita oraya gider). */
export const geoPlaceSchema = z.object({
  line: z.string().min(1).max(ADDRESS_LINE_MAX_LENGTH),
  location: geoPointSchema,
});

/** Sinirli liste (sayfalanmaz): en fazla GEO_SEARCH_RESULTS_MAX; sonuc yoksa bos. */
export const geoSearchResultSchema = z.object({
  items: z.array(geoPlaceSchema).max(GEO_SEARCH_RESULTS_MAX),
});

export type ReverseGeocodeQuery = z.input<typeof reverseGeocodeQuerySchema>;
export type ReverseGeocodeResult = z.infer<typeof reverseGeocodeResultSchema>;
export type GeoSearchQuery = z.input<typeof geoSearchQuerySchema>;
export type GeoPlace = z.infer<typeof geoPlaceSchema>;
export type GeoSearchResult = z.infer<typeof geoSearchResultSchema>;
