/**
 * Cesit gruplari (urun ve magaza cesitliligi, 07.10): marketlerin cesidi bu
 * gruplardan kurulur (assortments.ts). Gruplar SKU listesidir.
 *
 * IKI KOPYA: catalog-service ve inventory-service fixtures'inda AYNI dosya
 * (ADR-05: her servis kendi seed'ini yazar, digerinin kodunu okumaz). Tutarlilik
 * testi inventory'de: her teklifin stok kaydi var, fazlasi yok
 * (test/unit/stock-fixtures.spec.ts). Biri degisirse oburu de degisir.
 */

export const ASSORTMENT_GROUPS = {
  // Sut & Kahvaltilik: hepsi.
  KAHVALTI: [
    'SUT-1L',
    'YUMURTA-10',
    'PEYNIR-500',
    'TEREYAG-250',
    'KASAR-400',
    'ZEYTIN-500',
    'YOGURT-1K',
    'AYRAN-1L',
    'BAL-450',
    'RECEL-380',
    'LABNE-200',
  ],
  // Meyve & Sebze: hepsi.
  MANAV: [
    'DOMATES-1K',
    'MUZ-1K',
    'ELMA-1K',
    'SALATALIK-1K',
    'PATATES-1K',
    'SOGAN-1K',
    'LIMON-500',
    'PORTAKAL-1K',
    'BIBER-500',
    'MAYDANOZ',
  ],
  // Firindan: hepsi.
  FIRIN: [
    'EKMEK-SOMUN',
    'SIMIT',
    'POGACA-PEYNIRLI',
    'ACMA',
    'TAM-BUGDAY-EKMEK',
    'LAVAS-10',
    'POGACA-ZEYTINLI',
    'SU-BOREGI',
  ],
  // Temel Gida: hepsi.
  TEMEL: [
    'PIRINC-1K',
    'MAKARNA-500',
    'AYCICEK-YAGI-1L',
    'MERCIMEK-1K',
    'NOHUT-1K',
    'UN-2K',
    'SEKER-1K',
    'SALCA-830',
    'BULGUR-1K',
    'TUZ-750',
  ],
  // Zincir marketin paketli et ve tavugu.
  ET_PAKET: [
    'KIYMA-500',
    'TAVUK-GOGUS-1K',
    'TAVUK-BAGET-1K',
    'KOFTE-500',
    'SUCUK-250',
    'HINDI-FUME-150',
  ],
  // Kasap: et, tavuk, sucuk ve pastirma.
  KASAP: [
    'KIYMA-500',
    'KUSBASI-500',
    'TAVUK-GOGUS-1K',
    'TAVUK-BAGET-1K',
    'KOFTE-500',
    'KUZU-PIRZOLA-500',
    'SUCUK-250',
    'PASTIRMA-100',
  ],
  // Sarkuteri: peynir, zeytin, kahvaltilik ve sarkuteri eti.
  SARKUTERI: [
    'PEYNIR-500',
    'TEREYAG-250',
    'KASAR-400',
    'ZEYTIN-500',
    'BAL-450',
    'RECEL-380',
    'LABNE-200',
    'SUCUK-250',
    'PASTIRMA-100',
    'HINDI-FUME-150',
  ],
  // Icecek: hepsi.
  ICECEK: [
    'SU-5L',
    'KOLA-1L',
    'PORTAKAL-SUYU-1L',
    'MADEN-SUYU-6',
    'CAY-1K',
    'TURK-KAHVESI-100',
    'LIMONATA-1L',
    'SOGUK-CAY-330',
    'GAZOZ-1L',
    'SU-05L-6',
  ],
  // Paketli atistirmalik.
  ATISTIRMALIK: ['CIKOLATA-80', 'CIPS-150', 'BISKUVI-150', 'KRAKER-100', 'GOFRET-40'],
  // Kuruyemis ve kuru meyve.
  KURUYEMIS: [
    'FINDIK-200',
    'ANTEP-FISTIGI-200',
    'KAJU-200',
    'LEBLEBI-250',
    'KURU-KAYISI-250',
    'AY-CEKIRDEGI-200',
    'KARISIK-KURUYEMIS-200',
    'BADEM-200',
  ],
  // Dondurma: hepsi.
  DONDURMA: [
    'DONDURMA-KAKAO',
    'DONDURMA-CUBUK',
    'DONDURMA-KULAH',
    'DONDURMA-MARAS-500',
    'DONDURMA-MEYVELI',
    'DONDURMA-SANDVIC',
    'DONDURMA-VANILYA-1L',
    'DONDURMA-ANTEP-500',
  ],
  // Temizlik: hepsi.
  TEMIZLIK: [
    'BULASIK-DETERJAN',
    'CAMASIR-SUYU',
    'CAMASIR-DETERJANI-4K',
    'YUMUSATICI-15L',
    'YUZEY-TEMIZLEYICI',
    'CAM-TEMIZLEYICI',
    'BULASIK-TABLET-30',
    'SUNGER-3',
  ],
  // Kisisel Bakim: hepsi.
  BAKIM: [
    'SAMPUAN-500',
    'DIS-MACUNU',
    'SIVI-SABUN',
    'DIS-FIRCASI',
    'DUS-JELI-500',
    'DEODORANT-150',
    'TIRAS-KOPUGU',
    'PAMUK-100',
  ],
  // Ev & Yasam: cicek disi.
  EV: ['KAGIT-HAVLU-6', 'COP-POSETI', 'TUVALET-KAGIDI-16', 'PECETE-100', 'ALUMINYUM-FOLYO'],
  // Ev & Yasam: cicek ve saksi.
  CICEK: [
    'GUL-BUKET',
    'PAPATYA-BUKET',
    'ORKIDE-SAKSI',
    'LALE-BUKET',
    'SUKULENT-SAKSI',
    'AYCICEGI-BUKET',
  ],
  // Bebek: hepsi.
  BEBEK: [
    'BEBEK-BEZI-4',
    'ISLAK-MENDIL',
    'BEBEK-SAMPUANI',
    'BEBEK-BISKUVISI',
    'BIBERON-250',
    'BEBEK-BEZI-5',
    'PISIK-KREMI',
    'KASIK-MAMASI',
  ],
  // Evcil Hayvan: hepsi.
  PET: [
    'KEDI-MAMASI',
    'KOPEK-MAMASI',
    'KEDI-KUMU',
    'KEDI-YAS-MAMA',
    'KOPEK-ODUL',
    'KUS-YEMI-500',
    'BALIK-YEMI',
    'KEDI-ODUL-CUBUK',
  ],
} as const satisfies Readonly<Record<string, readonly string[]>>;

export type AssortmentGroup = keyof typeof ASSORTMENT_GROUPS;
