/**
 * Market -> cesit gruplari (urun ve magaza cesitliligi, 07.10). Zincir
 * marketler markasinin gruplarini (60-100 urun), dukkanlar turunun grubunu
 * tasir (dukkan yalnizca turunun kategorilerini satar). Ilk tablolardaki acik
 * teklif ve stoklar bunlara EK olarak kalir (birlesim).
 *
 * IKI KOPYA: catalog-service ve inventory-service fixtures'inda AYNI dosya
 * (gerekce assortment-groups.ts'te).
 */

import type { AssortmentGroup } from './assortment-groups.js';
import { ASSORTMENT_GROUPS } from './assortment-groups.js';

/** Migros Jet subeleri. */
const MIGROS_JET: readonly AssortmentGroup[] = [
  'KAHVALTI',
  'MANAV',
  'TEMEL',
  'ET_PAKET',
  'ICECEK',
  'ATISTIRMALIK',
  'DONDURMA',
  'TEMIZLIK',
  'BAKIM',
  'EV',
  'PET',
];

/** Carrefour Express subeleri. */
const CARREFOUR_EXPRESS: readonly AssortmentGroup[] = [
  'KAHVALTI',
  'MANAV',
  'TEMEL',
  'ET_PAKET',
  'ICECEK',
  'ATISTIRMALIK',
  'DONDURMA',
  'TEMIZLIK',
  'BAKIM',
  'EV',
  'BEBEK',
];

/** A101 subeleri. */
const A101: readonly AssortmentGroup[] = [
  'KAHVALTI',
  'MANAV',
  'TEMEL',
  'ICECEK',
  'ATISTIRMALIK',
  'KURUYEMIS',
  'DONDURMA',
  'TEMIZLIK',
  'BAKIM',
  'EV',
];

/** BIM subeleri (Sinanpasa'nin acik tablosundaki her grup dahil). */
const BIM: readonly AssortmentGroup[] = [
  'KAHVALTI',
  'TEMEL',
  'FIRIN',
  'ET_PAKET',
  'ICECEK',
  'ATISTIRMALIK',
  'DONDURMA',
  'TEMIZLIK',
  'BAKIM',
  'EV',
  'BEBEK',
  'PET',
];

/** SOK subeleri (Moda'nin acik tablosundaki her grup dahil). */
const SOK: readonly AssortmentGroup[] = [
  'KAHVALTI',
  'MANAV',
  'TEMEL',
  'FIRIN',
  'ICECEK',
  'ATISTIRMALIK',
  'DONDURMA',
  'TEMIZLIK',
  'BAKIM',
  'EV',
  'BEBEK',
  'PET',
];

/** Her demo marketin cesit gruplari (marketler eklenme sirasiyla). */
export const ASSORTMENTS: Readonly<Record<string, readonly AssortmentGroup[]>> = {
  'mkt_migros-jet-moda': MIGROS_JET,
  'mkt_a101-caferaga': A101,
  'mkt_kardesler-manavi': ['MANAV'],
  'mkt_migros-jet-besiktas': MIGROS_JET,
  'mkt_carrefour-express-barbaros': CARREFOUR_EXPRESS,
  'mkt_a101-abbasaga': A101,
  'mkt_sok-moda': SOK,
  'mkt_moda-kasabi': ['KASAP'],
  'mkt_moda-sarkuteri': ['SARKUTERI'],
  'mkt_altiyol-kuruyemis': ['KURUYEMIS'],
  'mkt_bahariye-firini': ['FIRIN'],
  'mkt_pati-pet-shop-kadikoy': ['PET'],
  'mkt_moda-cicekcilik': ['CICEK'],
  'mkt_bim-sinanpasa': BIM,
  'mkt_carsi-manavi': ['MANAV'],
  'mkt_barbaros-kasabi': ['KASAP'],
  'mkt_besiktas-sarkuteri': ['SARKUTERI'],
  'mkt_yildiz-kuruyemis': ['KURUYEMIS'],
  'mkt_abbasaga-firini': ['FIRIN'],
  'mkt_pati-pet-shop-besiktas': ['PET'],
  'mkt_lale-cicekcilik': ['CICEK'],
  'mkt_bim-yeldegirmeni': BIM,
  'mkt_carrefour-express-kadikoy': CARREFOUR_EXPRESS,
  'mkt_a101-hasanpasa': A101,
  'mkt_sok-feneryolu': SOK,
  'mkt_kardesler-manavi-hasanpasa': ['MANAV'],
  'mkt_bahariye-firini-yeldegirmeni': ['FIRIN'],
  'mkt_sok-turkali': SOK,
  'mkt_a101-dikilitas': A101,
  'mkt_migros-jet-ortakoy': MIGROS_JET,
  'mkt_carrefour-express-akaretler': CARREFOUR_EXPRESS,
  'mkt_carsi-manavi-ortakoy': ['MANAV'],
  'mkt_barbaros-kasabi-balmumcu': ['KASAP'],
};

/** Marketin cesidi: gruplarinin SKU'lari, tekrarsiz ve sirali. Bilinmeyen market bos. */
export function assortmentOf(marketId: string): readonly string[] {
  const skus = (ASSORTMENTS[marketId] ?? []).flatMap((group) => ASSORTMENT_GROUPS[group]);
  return [...new Set(skus)].sort();
}
