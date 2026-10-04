/**
 * Market listesinin dukkan turu suzgeci (T11.12): saf fonksiyonlar. Menudeki
 * gruplar ve tur adlari icerikten gelir (marketList.groups, storeTypes); bu
 * dosya yalnizca adresteki marketleri sayar, suzer ve menuyu kurar.
 */

import { storeTypeSchema } from '@getir/contracts';
import type { MarketListContent, NearbyMarket, StoreType } from '@getir/contracts';

/** Menude ya da cipte bir tur: adi ve adresteki market sayisi. */
export interface StoreTypeEntry {
  readonly type: StoreType;
  readonly label: string;
  readonly count: number;
}

/** Akordeon grubu: adresteki marketi olan turleriyle. */
export interface StoreTypeGroupEntry {
  readonly label: string;
  readonly imageUrl: string;
  readonly count: number;
  readonly types: readonly StoreTypeEntry[];
}

/** "?tur=kasap" -> "KASAP"; bilinmeyen ya da bos deger suzgec yok sayilir. */
export function storeTypeFromParam(value: string | null): StoreType | undefined {
  if (value === null) {
    return undefined;
  }
  // Adresteki deger ASCII'dir ("kuruyemis"): Turkce buyuk harf "İ" uretirdi.
  const parsed = storeTypeSchema.safeParse(value.toUpperCase());
  return parsed.success ? parsed.data : undefined;
}

/** "KASAP" -> "kasap" (adresteki bicim). */
export function storeTypeToParam(type: StoreType): string {
  return type.toLowerCase();
}

/** Turune gore market sayisi; turu bilinmeyen market sayilmaz. */
export function countByStoreType(markets: readonly NearbyMarket[]): ReadonlyMap<StoreType, number> {
  const counts = new Map<StoreType, number>();
  for (const { market } of markets) {
    if (market.storeType !== undefined) {
      counts.set(market.storeType, (counts.get(market.storeType) ?? 0) + 1);
    }
  }
  return counts;
}

/**
 * Menunun gruplari, icerikteki sirayla. Adreste marketi olmayan tur
 * gosterilmez; turu kalmayan grup da gosterilmez (bos satir olmaz).
 */
export function storeTypeGroups(
  content: Pick<MarketListContent, 'groups' | 'storeTypes'>,
  counts: ReadonlyMap<StoreType, number>,
): readonly StoreTypeGroupEntry[] {
  const labels = new Map(content.storeTypes.map((option) => [option.type, option.label]));
  return content.groups
    .map((group) => {
      const types = group.types
        .map((type) => ({ type, label: labels.get(type) ?? type, count: counts.get(type) ?? 0 }))
        .filter((entry) => entry.count > 0);
      const count = types.reduce((sum, entry) => sum + entry.count, 0);
      return { label: group.label, imageUrl: group.imageUrl, count, types };
    })
    .filter((group) => group.types.length > 0);
}

/** Secili tur yoksa butun marketler; varsa yalnizca o tur (sira korunur: yakindan uzaga). */
export function filterByStoreType(
  markets: readonly NearbyMarket[],
  type: StoreType | undefined,
): readonly NearbyMarket[] {
  return type === undefined ? markets : markets.filter(({ market }) => market.storeType === type);
}
