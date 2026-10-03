import type { AddressKind, AddressKindOption } from '@getir/contracts';

/**
 * Adres turunun ikonu (icerikten emoji; T11.10). Turu olmayan eski kayitta
 * (T11.8 oncesi) yok: cagiran genel konum ikonunu gosterir; "Ev" ikonu
 * yaniltirdi.
 */
export function kindIcon(
  kinds: readonly AddressKindOption[],
  kind: AddressKind | undefined,
): string | undefined {
  return kind === undefined ? undefined : kinds.find((option) => option.kind === kind)?.icon;
}
