/**
 * Adres ekleme formu (T11.8; 2. adim): SAF kurallar. Kurallar ve mesajlar
 * sozlesmeden gelir (@getir/contracts createAddressRequestSchema); gateway
 * ayni kurallari ayni cumlelerle uygular (rules_contract_test.go).
 *
 * Konum formda degildir: haritadan (1. adim) gelir ve istege burada eklenir.
 * Bos birakilan istege bagli alan (bina, kat, daire, tarif) istege yazilmaz.
 */

import { createAddressRequestSchema } from '@getir/contracts';
import type {
  AddressKind,
  AddressKindOption,
  CreateAddressRequest,
  GeoPoint,
} from '@getir/contracts';
import type { z } from 'zod';

/** Formun semasi: istek, konum haric. */
export const addressFormSchema = createAddressRequestSchema.omit({ location: true });

export type AddressFormValues = z.input<typeof addressFormSchema>;
export type AddressFormOutput = z.output<typeof addressFormSchema>;

/**
 * Alanlar EKRANDAKI sirayla: odak ilk hatali alana gider (form-errors.ts).
 * `addresses` alan degildir: dolu defter sunucunun cevabinda bu adla gelir ve
 * formun ustunde gosterilir.
 */
export const ADDRESS_FORM_FIELDS = [
  'kind',
  'title',
  'line',
  'building',
  'floor',
  'apartment',
  'note',
] as const satisfies readonly (keyof AddressFormValues)[];

export type AddressFormField = (typeof ADDRESS_FORM_FIELDS)[number];

/** Sunucunun alan disi sorunu (dolu defter; gateway auth.FieldAddresses). */
export const ADDRESS_BOOK_FIELD = 'addresses';

/**
 * Formun acilis degerleri: ilk tur secili, baslik onun etiketi ("Ev"); satir
 * haritadan cozulen adres (bulunamadiysa bos, kullanici yazar).
 */
export function initialAddressValues(
  kinds: readonly AddressKindOption[],
  line: string,
): AddressFormValues {
  const [first] = kinds;
  return {
    kind: first?.kind ?? 'HOME',
    title: first?.label ?? '',
    line,
    building: '',
    floor: '',
    apartment: '',
    note: '',
  };
}

/**
 * Tur degisince baslik: kullanici basligi elle degistirmediyse (bos ya da hala
 * bir turun etiketi) yeni turun etiketi; degistirdiyse yazdigi kalir.
 */
export function titleForKind(
  kinds: readonly AddressKindOption[],
  currentTitle: string,
  nextKind: AddressKind,
): string {
  const trimmed = currentTitle.trim();
  const followsKind = trimmed === '' || kinds.some((option) => option.label === trimmed);
  const label = kinds.find((option) => option.kind === nextKind)?.label;
  return followsKind && label !== undefined ? label : currentTitle;
}

/** Dogrulanmis form + haritadaki konum -> istek govdesi; bos istege bagli alan yazilmaz. */
export function toCreateAddressRequest(
  values: AddressFormOutput,
  location: GeoPoint,
): CreateAddressRequest {
  const request: CreateAddressRequest = {
    title: values.title,
    kind: values.kind,
    line: values.line,
    location,
  };
  for (const field of ['building', 'floor', 'apartment', 'note'] as const) {
    const value = values[field];
    if (value !== undefined && value !== '') {
      request[field] = value;
    }
  }
  return request;
}
