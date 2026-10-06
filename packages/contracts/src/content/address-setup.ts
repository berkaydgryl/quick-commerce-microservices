/**
 * Adres ekleme penceresi ve haritasi (T11.8; R1, D18: content.ts'ten tasindi).
 */

import { z } from 'zod';

import { addressKindSchema } from '../cart.js';
import { geoPointSchema } from '../common.js';
import { CONTENT_MAP_ZOOM_MAX, CONTENT_MAP_ZOOM_MIN } from '../constants.js';
import { contentTextSchema } from './content-text.js';

/** Adres turu secenegi (T11.8): "Ev" + ikon (emoji). */
export const addressKindOptionSchema = z.object({
  kind: addressKindSchema,
  label: contentTextSchema,
  icon: contentTextSchema,
});

/**
 * Harita (T11.8): OpenStreetMap karolari. Karo adresi https ve {z}/{x}/{y}
 * yer tutuculu; atif metni OSM lisansi geregi haritada gorunur. Baslangic
 * noktasi demo marketlerin oldugu semt.
 */
export const mapContentSchema = z.object({
  tileUrl: z
    .string()
    .startsWith('https://')
    .refine((url) => ['{z}', '{x}', '{y}'].every((part) => url.includes(part)), {
      message: 'karo adresi {z}, {x} ve {y} tasimali',
    }),
  attribution: contentTextSchema,
  center: geoPointSchema,
  zoom: z.number().int().min(CONTENT_MAP_ZOOM_MIN).max(CONTENT_MAP_ZOOM_MAX),
});

/**
 * Adres ekleme penceresi (T11.8): oturum acik ama kayitli adres yoksa
 * karsilama ekraninin ustunde acilir. 1. adim harita + arama + "Bu adresi
 * kullan"; 2. adim detay (baslik, adres, bina/kat/daire, tarif) + "Kaydet".
 */
export const addressSetupContentSchema = z.object({
  title: contentTextSchema,
  /** 2. adimdaki geri dugmesinin erisilebilir adi. */
  backLabel: contentTextSchema,
  pinHint: contentTextSchema,
  searchLabel: contentTextSchema,
  searchPlaceholder: contentTextSchema,
  searchSubmitLabel: contentTextSchema,
  searchEmptyNotice: contentTextSchema,
  useAddressLabel: contentTextSchema,
  resolvingLabel: contentTextSchema,
  /** Pinin oldugu yer icin adres bulunamadi: satiri kullanici yazar. */
  unresolvedNotice: contentTextSchema,
  kindLabel: contentTextSchema,
  kinds: z
    .array(addressKindOptionSchema)
    .min(1)
    .max(addressKindSchema.options.length)
    .refine((kinds) => new Set(kinds.map((option) => option.kind)).size === kinds.length, {
      message: 'ayni adres turu iki kez yazilamaz',
    }),
  titleLabel: contentTextSchema,
  lineLabel: contentTextSchema,
  buildingLabel: contentTextSchema,
  floorLabel: contentTextSchema,
  apartmentLabel: contentTextSchema,
  noteLabel: contentTextSchema,
  saveLabel: contentTextSchema,
  savingLabel: contentTextSchema,
  /** Secilen yere hizmet veren market yok: uyari, kaydi engellemez. */
  noMarketNotice: contentTextSchema,
  map: mapContentSchema,
});

export type AddressKindOption = z.infer<typeof addressKindOptionSchema>;

export type MapContent = z.infer<typeof mapContentSchema>;

export type AddressSetupContent = z.infer<typeof addressSetupContentSchema>;
