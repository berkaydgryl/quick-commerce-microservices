/**
 * Uretilen tekliflerin fiyati (urun ve magaza cesitliligi, 07.10): urunun
 * TABAN fiyati x markanin fiyat endeksi, TL'ye yuvarlanip ,90 ile biter
 * (3490 x 0,92 -> 3190). Belirlenimci: tekrar kosan seed ayni fiyati yazar.
 *
 * Taban fiyat ilk 49 urunde Migros Jet Moda'nin ACIK fiyatidir (o satmiyorsa
 * urunun ilk acik fiyati); yeni urunlerde Migros duzeyinde bir deger.
 */

/** SKU -> taban fiyat (kurus). Her ortak urunun bir tabani vardir (test). */
export const BASE_PRICES: Readonly<Record<string, number>> = {
  'SUT-1L': 3490,
  'YUMURTA-10': 8990,
  'PEYNIR-500': 14990,
  'TEREYAG-250': 12750,
  'DOMATES-1K': 5990,
  'MUZ-1K': 7490,
  'ELMA-1K': 4290,
  'SALATALIK-1K': 3990,
  'SU-5L': 2990,
  'KOLA-1L': 4590,
  'PORTAKAL-SUYU-1L': 6490,
  'CIKOLATA-80': 3290,
  'CIPS-150': 4990,
  'BULASIK-DETERJAN': 6790,
  'CAMASIR-SUYU': 5490,
  'EKMEK-SOMUN': 1460,
  SIMIT: 1750,
  'POGACA-PEYNIRLI': 2250,
  ACMA: 2000,
  'PIRINC-1K': 8720,
  'MAKARNA-500': 2420,
  'AYCICEK-YAGI-1L': 9210,
  'MERCIMEK-1K': 7270,
  'KIYMA-500': 39000,
  'KUSBASI-500': 42640,
  'TAVUK-GOGUS-1K': 23820,
  'SUCUK-250': 28600,
  'PASTIRMA-100': 34450,
  'KASAR-400': 23210,
  'ZEYTIN-500': 15790,
  'DONDURMA-KAKAO': 11540,
  'DONDURMA-CUBUK': 3390,
  'SAMPUAN-500': 13480,
  'DIS-MACUNU': 7750,
  'SIVI-SABUN': 6170,
  'KAGIT-HAVLU-6': 15420,
  'COP-POSETI': 4840,
  'GUL-BUKET': 89000,
  'PAPATYA-BUKET': 45000,
  'ORKIDE-SAKSI': 120000,
  'BEBEK-BEZI-4': 38700,
  'ISLAK-MENDIL': 6780,
  'KEDI-MAMASI': 41610,
  'KOPEK-MAMASI': 64900,
  'KEDI-KUMU': 24900,
  'FINDIK-200': 21000,
  'ANTEP-FISTIGI-200': 32000,
  'KAJU-200': 26500,
  'LEBLEBI-250': 9000,
  'YOGURT-1K': 8990,
  'AYRAN-1L': 3990,
  'BAL-450': 24990,
  'RECEL-380': 8990,
  'LABNE-200': 6990,
  'PATATES-1K': 2990,
  'SOGAN-1K': 2490,
  'LIMON-500': 3490,
  'PORTAKAL-1K': 4990,
  'BIBER-500': 4490,
  MAYDANOZ: 1990,
  'TAM-BUGDAY-EKMEK': 3490,
  'LAVAS-10': 4990,
  'POGACA-ZEYTINLI': 2290,
  'SU-BOREGI': 17990,
  'NOHUT-1K': 7990,
  'UN-2K': 6990,
  'SEKER-1K': 4990,
  'SALCA-830': 9990,
  'BULGUR-1K': 4990,
  'TUZ-750': 1990,
  'TAVUK-BAGET-1K': 18990,
  'KOFTE-500': 34990,
  'HINDI-FUME-150': 8990,
  'KUZU-PIRZOLA-500': 64990,
  'MADEN-SUYU-6': 4990,
  'CAY-1K': 29990,
  'TURK-KAHVESI-100': 9990,
  'LIMONATA-1L': 5990,
  'SOGUK-CAY-330': 2490,
  'GAZOZ-1L': 3990,
  'SU-05L-6': 3490,
  'BISKUVI-150': 2990,
  'KRAKER-100': 1990,
  'GOFRET-40': 1490,
  'KURU-KAYISI-250': 14990,
  'AY-CEKIRDEGI-200': 6990,
  'KARISIK-KURUYEMIS-200': 24990,
  'BADEM-200': 26990,
  'DONDURMA-KULAH': 3990,
  'DONDURMA-MARAS-500': 19990,
  'DONDURMA-MEYVELI': 2990,
  'DONDURMA-SANDVIC': 3490,
  'DONDURMA-VANILYA-1L': 15990,
  'DONDURMA-ANTEP-500': 17990,
  'CAMASIR-DETERJANI-4K': 34990,
  'YUMUSATICI-15L': 12990,
  'YUZEY-TEMIZLEYICI': 8990,
  'CAM-TEMIZLEYICI': 7990,
  'BULASIK-TABLET-30': 29990,
  'SUNGER-3': 3990,
  'DIS-FIRCASI': 4990,
  'DUS-JELI-500': 11990,
  'DEODORANT-150': 13990,
  'TIRAS-KOPUGU': 10990,
  'PAMUK-100': 3990,
  'TUVALET-KAGIDI-16': 24990,
  'PECETE-100': 2990,
  'ALUMINYUM-FOLYO': 6990,
  'LALE-BUKET': 59990,
  'SUKULENT-SAKSI': 34990,
  'AYCICEGI-BUKET': 44990,
  'BEBEK-SAMPUANI': 14990,
  'BEBEK-BISKUVISI': 8990,
  'BIBERON-250': 24990,
  'BEBEK-BEZI-5': 44990,
  'PISIK-KREMI': 12990,
  'KASIK-MAMASI': 11990,
  'KEDI-YAS-MAMA': 3490,
  'KOPEK-ODUL': 9990,
  'KUS-YEMI-500': 7990,
  'BALIK-YEMI': 5990,
  'KEDI-ODUL-CUBUK': 6990,
};

/**
 * Marka -> fiyat endeksi (yuzde): A101 ve BIM ucuz, Carrefour pahali (ilk
 * tablolarla ayni yonde). Her demo markasi ACIKCA yazilir: listede olmayan
 * marka hatadir (sessizce 100 sayilmaz; test her marketin markasini arar).
 */
export const BRAND_PRICE_INDEX: Readonly<Record<string, number>> = {
  'Migros Jet': 100,
  'Carrefour Express': 105,
  A101: 92,
  BİM: 90,
  ŞOK: 94,
  'Kardeşler Manavı': 90,
  'Çarşı Manavı': 92,
  'Moda Kasabı': 100,
  'Barbaros Kasabı': 98,
  'Moda Şarküteri': 103,
  'Beşiktaş Şarküteri': 100,
  'Altıyol Kuruyemiş': 97,
  'Yıldız Kuruyemiş': 100,
  'Bahariye Fırını': 95,
  'Abbasağa Fırını': 97,
  'Pati Pet Shop': 105,
  'Moda Çiçekçilik': 100,
  'Lale Çiçekçilik': 102,
};

/** Endeks yuzdedir. */
const PERCENT = 100;
/** Kurus: fiyat TL'ye yuvarlanir, sonra 10 kurus dusulur (,90). */
const KURUS_PER_LIRA = 100;
const PRICE_ENDING_DISCOUNT = 10;

/** Taban fiyattan markanin fiyati: TL'ye yuvarlanmis, ,90 ile biten kurus. */
export function brandPrice(basePriceMinor: number, brand: string): number {
  const index = BRAND_PRICE_INDEX[brand];
  if (index === undefined) {
    throw new Error(`fiyat endeksi olmayan marka: ${brand}`);
  }
  const lira = Math.round((basePriceMinor * index) / PERCENT / KURUS_PER_LIRA);
  return lira * KURUS_PER_LIRA - PRICE_ENDING_DISCOUNT;
}
