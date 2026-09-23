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
 * Aramada karsilastirilacak bicim: Turkce kurallariyla kucuk harf.
 *
 * Bellek ve Mongo uygulamasi AYNI normalizasyonu kullanir. Mongo'nun regex
 * "i" bayragi Turkce'yi bilmez ("İ" ile "i" eslesmez); bu yuzden Mongo tarafi
 * bu fonksiyonun ciktisini YAZIM ANINDA saklar (offers.searchTerms).
 */
export function searchKey(text: string): string {
  return text.trim().toLocaleLowerCase('tr');
}

/** Bir urunun aranan metinleri: ad ve aciklama, normalize edilmis. */
export function searchTermsOf(product: Product): readonly string[] {
  return [searchKey(product.name), searchKey(product.description)];
}

/** Serbest metin aramasi: ad ve aciklamada, buyuk/kucuk harf duyarsiz. */
export function matchesQuery(product: Product, query: string): boolean {
  const needle = searchKey(query);
  return searchTermsOf(product).some((term) => term.includes(needle));
}
