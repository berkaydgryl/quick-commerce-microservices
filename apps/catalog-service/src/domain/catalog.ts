/**
 * Katalog alaninin (domain) varliklari ve saf kurallari - PAZARYERI (ADR-15).
 *
 * KURAL: bu dosya DISARI BAKMAZ. Icinde mongodb, ioredis, grpc ya da uretilen
 * proto tipi importu YOKTUR. Sozlesme (proto) ile is modeli ayni hizda
 * degismez; aradaki ceviri interfaces/grpc/mappers.ts ve infrastructure'dadir.
 *
 * Model: urun ORTAKTIR ve fiyat tasimaz; bir marketin o urunu hangi fiyatla
 * sattigi TEKLIFTIR (Offer). Market kendi kurallarini (minimum sepet, teslimat
 * ucreti) tasir.
 */

/** Satis birimi. Proto'daki Unit enum'unun domain karsiligi. */
export const PRODUCT_UNIT = {
  PIECE: 'PIECE',
  KILOGRAM: 'KILOGRAM',
  LITER: 'LITER',
  PACK: 'PACK',
} as const;

export type ProductUnit = (typeof PRODUCT_UNIT)[keyof typeof PRODUCT_UNIT];

export interface Category {
  readonly id: string;
  readonly name: string;
  /** URL'de kullanilan okunabilir kimlik: "sut-kahvaltilik". */
  readonly slug: string;
  /** Vitrinde gosterim sirasi; kucuk deger once gelir. */
  readonly sortOrder: number;
  /** GORELI yol; mutlak URL'yi gateway kurar. */
  readonly imageUrl: string;
}

/** Ortak urun: marketten bagimsiz. Fiyat YOK (ADR-15). */
export interface Product {
  readonly id: string;
  /** Stok tutma birimi; inventory-svc ile ortak anahtardir. */
  readonly sku: string;
  readonly name: string;
  readonly description: string;
  readonly categoryId: string;
  readonly unit: ProductUnit;
  readonly imageUrl: string;
}

/** Marketin sepet kurallari. Tutarlar KURUS, tam sayi. */
export interface PricingRules {
  readonly minBasketMinor: number;
  readonly deliveryFeeMinor: number;
  /** Ara toplam (indirim ONCESI, B12) buna ulasirsa teslimat ucretsizdir. */
  readonly freeDeliveryThresholdMinor: number;
}

export interface Market {
  readonly id: string;
  readonly name: string;
  readonly brand: string;
  /** GORELI yol; mutlak URL'yi gateway kurar. */
  readonly logoUrl: string;
  readonly lat: number;
  readonly lng: number;
  readonly deliveryRadiusMeters: number;
  /** Kapali market listede gorunur ama siparis almaz. */
  readonly isOpen: boolean;
  readonly deliveryTime: { readonly minMinutes: number; readonly maxMinutes: number };
  /** Onda bir hassasiyetle tam sayi: 47 = 4.7. Seed'de sabit (ADR-15). */
  readonly rating: { readonly averageTenths: number; readonly count: number };
  /** Market paneli olmadigi icin bugun seed'den gelir. */
  readonly pricingRules: PricingRules;
}

/**
 * Bir marketin bir urunu satisi: FIYATIN sahibi.
 *
 * Urun bilgisi teklifle birlikte tasinir; market sayfasi teklifleri listeler
 * ve her satirda ad, gorsel ve fiyat birlikte lazimdir.
 */
export interface Offer {
  readonly id: string;
  readonly marketId: string;
  readonly product: Product;
  /** Bu marketteki liste fiyati, KURUS. Float yasak. */
  readonly priceMinor: number;
  /** false: market urunu satistan kaldirmis. Listeden GIZLENMEZ (istemci "satista degil" gosterir). */
  readonly isActive: boolean;
}

/** Katalog kimliginin oneksiz govdesi: "mkt_migros-jet-moda" -> "migros-jet-moda". */
function idBody(id: string): string {
  const separator = id.indexOf('_');
  return separator === -1 ? id : id.slice(separator + 1);
}

/**
 * Teklif kimligi market ve urunden TURETILIR: "ofr_migros-jet-moda-sut-1l".
 * Ayni ikili icin her zaman ayni kimlik: seed tekrar kosunca degismez.
 */
export function offerIdFor(marketId: string, productId: string): string {
  return `ofr_${idBody(marketId)}-${idBody(productId)}`;
}

/**
 * Kategorileri vitrin sirasina dizer.
 *
 * Ayni sort_order'a sahip iki kategori olursa sira ADA gore belirlenir; aksi
 * halde liste her istekte farkli sirada donebilir. Turkce siralama icin
 * localeCompare('tr').
 */
export function sortCategories(categories: readonly Category[]): readonly Category[] {
  return [...categories].sort(
    (left, right) => left.sortOrder - right.sortOrder || left.name.localeCompare(right.name, 'tr'),
  );
}

/**
 * Kategori okumasinin KESME kurali (D6): sortOrder, sonra kimlik (ikili)
 * sirasinin ilk `limit` kategorisi. Mongo ayni sirayi
 * sort({ sortOrder: 1, _id: 1 }).limit() ile uygular; bellek uygulamasi bu
 * fonksiyonu kullanir ki iki uygulama ayni kategorileri birakir. Gosterim
 * sirasi bu DEGIL, sortCategories'tir.
 */
export function firstCategories(
  categories: readonly Category[],
  limit: number,
): readonly Category[] {
  return [...categories]
    .sort((left, right) => left.sortOrder - right.sortOrder || compareIds(left.id, right.id))
    .slice(0, limit);
}

/**
 * Teklifleri kararli (stable) sirada dizer: kimlige gore, IKILI karsilastirma.
 *
 * NEDEN IKILI: imlec "_id > token" ile ilerler (pagination.ts) ve Mongo da
 * string'i ikili siralar. Yerel siralama kullanilsaydi bellek ve Mongo
 * uygulamasi farkli sayfa kesebilirdi.
 */
export function sortOffers(offers: readonly Offer[]): readonly Offer[] {
  return [...offers].sort((left, right) => compareIds(left.id, right.id));
}

function compareIds(left: string, right: string): number {
  if (left === right) {
    return 0;
  }
  return left < right ? -1 : 1;
}

/**
 * Aramada karsilastirilacak bicim: Turkce kurallariyla kucuk harf, sonra
 * Turkce karakterler KATLANIR (T9.4): "Süt" -> "sut", "ÇİKOLATA" -> "cikolata",
 * "Işık" -> "isik". Klavyesinde Turkce karakter olmayan kullanici "sut" yazarak
 * "Süt"u bulur; "süt" yazan da ayni sonucu alir.
 *
 * Bellek ve Mongo uygulamasi AYNI normalizasyonu kullanir. Mongo'nun regex
 * "i" bayragi Turkce'yi bilmez ("İ" ile "i" eslesmez); bu yuzden Mongo tarafi
 * bu fonksiyonun ciktisini YAZIM ANINDA saklar (offers.searchTerms). Fonksiyon
 * degisirse saklanan terimler eskir: pnpm seed yeniden yazar, acilis denetimi
 * eskisini uyari olarak bildirir.
 */
export function searchKey(text: string): string {
  return (
    text
      .trim()
      .toLocaleLowerCase('tr')
      // Birlesik isaretler ayrilip atilir: ç ş ğ ö ü (ve â î û).
      .normalize('NFD')
      .replace(/\p{M}/gu, '')
      // Noktasiz i ayrismaz; elle katlanir.
      .replace(/ı/g, 'i')
  );
}

/**
 * Sorgunun kelimeleri (T9.4): bosluklarla ayrilir, her biri searchKey'den
 * gecer, tekrar eden kelime tek sayilir. Urun, kelimelerin HEPSI adinda ya da
 * aciklamasinda geciyorsa eslesir; kelimelerin sirasi onemsizdir.
 */
export function searchWords(query: string): readonly string[] {
  return [
    ...new Set(
      searchKey(query)
        .split(/\s+/)
        .filter((word) => word !== ''),
    ),
  ];
}

/** Bir urunun aranan metinleri: ad ve aciklama, normalize edilmis. */
export function searchTermsOf(product: Product): readonly string[] {
  return [searchKey(product.name), searchKey(product.description)];
}

/**
 * Serbest metin aramasi: her kelime ad ya da aciklamada gecmeli (sira
 * onemsiz), buyuk/kucuk harf ve Turkce karakter duyarsiz. Kelime icinde de
 * eslesir: "çik" -> "Çikolata" (yazarken arama, T9.5).
 */
export function matchesQuery(product: Product, query: string): boolean {
  const terms = searchTermsOf(product);
  return searchWords(query).every((word) => terms.some((term) => term.includes(word)));
}
