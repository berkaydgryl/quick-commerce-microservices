/**
 * Katalog alanininin (domain) varliklari ve saf kurallari.
 *
 * KURAL: bu dosya DISARI BAKMAZ. Icinde mongodb, ioredis, grpc ya da uretilen
 * proto tipi importu YOKTUR. Sebep: sozlesme (proto) ile is modeli ayni sey
 * degildir ve ayni hizda degismezler. Proto'ya bir alan eklendiginde domain
 * degismek zorunda kalmasin, domain'de bir kural degistiginde tel uzerindeki
 * bicim bozulmasin diye arada bir cevirici katman var (interfaces/grpc/mapper).
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
  readonly imageUrl: string;
}

export interface Product {
  readonly id: string;
  /** Stok tutma birimi; inventory-svc ile ortak anahtardir. */
  readonly sku: string;
  readonly name: string;
  readonly description: string;
  /** Liste fiyati, KURUS cinsinden tam sayi. Float yasak. */
  readonly priceMinor: number;
  readonly categoryId: string;
  readonly unit: ProductUnit;
  readonly imageUrl: string;
  /** false ise katalogdan gizlenir; kayit silinmez (gecmis siparisler bozulmasin). */
  readonly isActive: boolean;
}

export interface DarkStore {
  readonly id: string;
  readonly name: string;
  readonly lat: number;
  readonly lng: number;
  readonly deliveryRadiusMeters: number;
  readonly isOpen: boolean;
}

/**
 * Kategorileri vitrin sirasina dizer.
 *
 * Ayni sort_order'a sahip iki kategori olursa sira ADA gore belirlenir; aksi
 * halde liste her istekte farkli sirada donebilir ve kullanici "kategoriler
 * yer degistiriyor" diye gorur. Turkce siralama icin localeCompare('tr').
 */
export function sortCategories(categories: readonly Category[]): readonly Category[] {
  return [...categories].sort(
    (left, right) => left.sortOrder - right.sortOrder || left.name.localeCompare(right.name, 'tr'),
  );
}

/**
 * Urunleri kararli (stable) sirada dizer: kimlige gore.
 *
 * NEDEN KIMLIK: sayfalama imleci bu siraya dayanir (bkz. pagination.ts).
 * Populerlik ya da fiyat gibi degisken bir alana gore siralansaydi, iki sayfa
 * arasinda sira kayar ve ayni urun iki kez gorunur ya da hic gorunmezdi.
 */
export function sortProducts(products: readonly Product[]): readonly Product[] {
  // IKILI (binary) karsilastirma, localeCompare DEGIL: imlec "_id > token"
  // ile ilerler (pagination.ts) ve Mongo da string'i ikili siralar. Yerel
  // siralama kullanilsaydi bellek ve Mongo uygulamasi farkli sayfa kesebilirdi.
  return [...products].sort((left, right) => compareIds(left.id, right.id));
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
 * NEDEN AYRI FONKSIYON: bellek ve Mongo uygulamasi AYNI normalizasyonu
 * kullanmak zorunda. Mongo'nun regex "i" bayragi Turkce'yi bilmez ("İ" ile "i"
 * eslesmez); bu yuzden Mongo tarafi bu fonksiyonun ciktisini YAZIM ANINDA
 * saklar (products.searchTerms) ve aramayi o alanda yapar.
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
