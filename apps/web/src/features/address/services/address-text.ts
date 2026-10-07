import type { AddressSetupContent, SavedAddress } from '@getir/contracts';

/** Parcalarin etiketleri: adres formundakilerin aynisi ("Bina", "Kat", "Daire"). */
export type AddressPartLabels = Pick<
  AddressSetupContent,
  'buildingLabel' | 'floorLabel' | 'apartmentLabel'
>;

/**
 * Adresin tam metni (T16.3; sepet ve odeme sayfalarinin adres karti): satir ve
 * varsa bina, kat, daire, virgulle ("Moda Cad. No:12, Bina: 6A, Kat: 2,
 * Daire: 2"). Bos parca yazilmaz; adres tarifi (note) karta girmez.
 */
export function addressFullText(address: SavedAddress, labels: AddressPartLabels): string {
  const parts: readonly (readonly [string, string | undefined])[] = [
    [labels.buildingLabel, address.building],
    [labels.floorLabel, address.floor],
    [labels.apartmentLabel, address.apartment],
  ];
  return [
    address.line,
    ...parts.flatMap(([label, value]) =>
      value === undefined || value.trim() === '' ? [] : [`${label}: ${value.trim()}`],
    ),
  ].join(', ');
}
