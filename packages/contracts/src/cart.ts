/**
 * Sepet ve rezervasyon uclarinin semalari:
 *   POST   /v1/cart/reserve
 *   DELETE /v1/cart/reserve/{orderId}
 *
 * Sepetin kendisi SUNUCUDA TUTULMAZ (ADR-13): tarayicida yasar ve yalnizca
 * rezervasyon aninda sunucuya gelir. Bu yuzden burada "sepete ekle" gibi bir
 * uc yoktur; sepet tek seferde rezerve edilir.
 *
 * T7.5: govde order sozlesmesine (proto CreateDraftOrderRequest) hizalandi -
 * teslimat adresi, istemcinin gordugu toplam ve kupon rezervasyonda gelir.
 */

import { z } from 'zod';

import {
  geoPointSchema,
  idSchema,
  isoDateTimeSchema,
  marketIdSchema,
  moneySchema,
  productIdSchema,
} from './common.js';
import {
  ADDRESS_LINE_MAX_LENGTH,
  ADDRESS_NOTE_MAX_LENGTH,
  ADDRESS_TITLE_MAX_LENGTH,
  ADDRESS_UNIT_MAX_LENGTH,
  CART_ITEM_MAX_QUANTITY,
  CART_ITEM_MIN_QUANTITY,
  CART_MAX_ITEMS,
  CART_MIN_ITEMS,
  COUPON_CODE_MAX_LENGTH,
  SAVED_ADDRESSES_MAX,
} from './constants.js';
import { orderStatusSchema } from './order-status.js';

/**
 * Sepet satiri girdisi.
 *
 * FIYAT TASIMAZ. Istemcinin gonderdigi fiyata guvenmek, sepeti duzenleyip
 * bedava siparis acmaya izin verirdi; tutarlar sunucuda katalog fiyatindan
 * hesaplanir. sku da tasinmaz: sunucu onu catalog teklifinden alir.
 */
export const cartItemInputSchema = z.object({
  productId: productIdSchema,
  // Mesajlar Turkce: web istemci tarafinda bu semayla dogrular ve metni gosterir.
  quantity: z
    .number()
    .int('tam sayi olmali')
    .min(CART_ITEM_MIN_QUANTITY, `en az ${CART_ITEM_MIN_QUANTITY} olmali`)
    .max(CART_ITEM_MAX_QUANTITY, `en fazla ${CART_ITEM_MAX_QUANTITY} olmali`),
});

/**
 * Teslimat adresi: rezervasyonda verilir (T7.5), sipariste gosterilir.
 *
 * NEDEN REZERVASYONDA: teslimat konumu tutarin (teslimat ucreti), marketin
 * hizmet alaninin ve risk kurallarinin (geofence) girdisidir; sunucu taslagi
 * acarken bilmek zorundadir (proto CreateDraftOrderRequest.delivery_location).
 *
 * Adres etiketi ("Ev") ve not BILEREK YOK: siparis sozlesmesinde (proto)
 * karsiliklari yok. Kabul edilip sessizce dusurulmek yerine bilinmeyen alan
 * olarak reddedilirler (gateway). Etiket ve not KAYITLI adrese aittir
 * (savedAddressSchema); siparise giderken yalnizca line ve location tasinir.
 */
export const deliveryAddressSchema = z.object({
  /** Kullanicinin girdigi serbest metin adres; yalnizca gosterim icindir. */
  line: z.string().trim().min(1).max(ADDRESS_LINE_MAX_LENGTH),
  /** Konum gercegi buradadir. */
  location: geoPointSchema,
});

/**
 * Kullanicinin KAYITLI adresi (adres defteri; T8.1 users.addresses[]):
 * teslimat adresi + etiket + istege bagli not. Demo adresleri
 * (apps/gateway/internal/persona/addresses.json) bu bicimdedir. Siparise giderken yalnizca
 * teslimat adresi kismi (line, location) tasinir.
 */
/** Adres turu (T11.8): adres defterinde ikonu belirler. T11.8'den once yazilan kayitlarda yok. */
export const addressKindSchema = z.enum(['HOME', 'WORK', 'OTHER']);

export const savedAddressSchema = deliveryAddressSchema.extend({
  /** Kullanicinin verdigi ad ("Ev", "Is"). */
  title: z.string().trim().min(1),
  kind: addressKindSchema.optional(),
  /** Bina, kat, daire (T11.8): kisa serbest metin; bossa alan yok. */
  building: z.string().max(ADDRESS_UNIT_MAX_LENGTH).optional(),
  floor: z.string().max(ADDRESS_UNIT_MAX_LENGTH).optional(),
  apartment: z.string().max(ADDRESS_UNIT_MAX_LENGTH).optional(),
  /** Adres tarifi. */
  note: z.string().max(ADDRESS_NOTE_MAX_LENGTH).optional(),
});

/** Bina, kat ve daire alaninin kurali; mesaj alanin adiyla (gateway ayni cumleyi doner). */
function addressUnitSchema(label: string) {
  return z
    .string()
    .trim()
    .max(ADDRESS_UNIT_MAX_LENGTH, `${label} en fazla ${ADDRESS_UNIT_MAX_LENGTH} karakter olabilir`)
    .optional();
}

/**
 * POST /v1/me/addresses (T11.8): adres defterine yeni adres. Kalici kayit:
 * Idempotency-Key ister (ADR-08). Cevap guncel adres defteridir
 * (savedAddressListSchema). Gateway ayrica iki kurali uygular: ayni adla
 * ikinci adres olmaz (secici adla secer) ve defter SAVED_ADDRESSES_MAX'i
 * asmaz; ikisi de VALIDATION_FAILED. Mesajlar Turkce ve gateway'le ayni
 * (rules_contract_test).
 */
export const createAddressRequestSchema = z.object({
  title: z
    .string()
    .trim()
    .min(1, 'Başlık boş olamaz')
    .max(ADDRESS_TITLE_MAX_LENGTH, `Başlık en fazla ${ADDRESS_TITLE_MAX_LENGTH} karakter olabilir`),
  kind: addressKindSchema,
  line: z
    .string()
    .trim()
    .min(1, 'Adres boş olamaz')
    .max(ADDRESS_LINE_MAX_LENGTH, `Adres en fazla ${ADDRESS_LINE_MAX_LENGTH} karakter olabilir`),
  location: geoPointSchema,
  building: addressUnitSchema('Bina'),
  floor: addressUnitSchema('Kat'),
  apartment: addressUnitSchema('Daire'),
  note: z
    .string()
    .trim()
    .max(
      ADDRESS_NOTE_MAX_LENGTH,
      `Adres tarifi en fazla ${ADDRESS_NOTE_MAX_LENGTH} karakter olabilir`,
    )
    .optional(),
});

/**
 * GET /v1/me/addresses (T9.5): oturumdaki kullanicinin adres defteri, kayit
 * sirasinda. Sayfasiz SINIRLI liste: en fazla SAVED_ADDRESSES_MAX. Adresi
 * olmayan hesapta bos liste (hata degil).
 */
export const savedAddressListSchema = z.object({
  items: z.array(savedAddressSchema).max(SAVED_ADDRESSES_MAX),
});

/**
 * Rezervasyon istegi. Sepet TEK MARKETTIR (ADR-15): tum kalemler marketId'nin
 * teklifleri olmalidir; satista olmayan urun VALIDATION_FAILED (ayrintida
 * unavailableProductIds).
 */
export const reserveCartRequestSchema = z.object({
  marketId: marketIdSchema,
  items: z
    .array(cartItemInputSchema)
    .min(CART_MIN_ITEMS, 'sepet bos olamaz')
    .max(CART_MAX_ITEMS, `en fazla ${CART_MAX_ITEMS} kalem olmali`),
  address: deliveryAddressSchema,
  /**
   * Kullanicinin ekranda gordugu toplam (T7.2). Sunucu tutari kendisi hesaplar;
   * tutmazsa 409 PRICE_CHANGED (ayrintida guncel toplam) ve taslak acilmaz.
   * ZORUNLU: istege bagli olsaydi istemci gondermeyerek kontrolu atlayabilirdi.
   */
  expectedTotal: moneySchema,
  /** Kupon kodu (ornek: ILK10). Uygulanamazsa 422 COUPON_INVALID (ayrintida sebep). */
  couponCode: z.string().trim().min(1).max(COUPON_CODE_MAX_LENGTH).optional(),
});

/** Rezerve edilmis, fiyati DONDURULMUS satir. */
export const reservationLineSchema = z.object({
  productId: productIdSchema,
  name: z.string(),
  quantity: z.number().int().min(CART_ITEM_MIN_QUANTITY),
  unitPrice: moneySchema,
  /** unitPrice * quantity. Istemcide tekrar carpilmasin diye tasinir. */
  lineTotal: moneySchema,
});

/**
 * Rezervasyon cevabi: acilan taslak siparis (proto CreateDraftOrderResponse).
 *
 * Kalemler ve tutar burada DONMEZ: taslak ancak sunucunun toplami istemcinin
 * gordugu toplamla (expectedTotal) birebir tuttuysa acilir, yani istemci onu
 * zaten biliyor. Dokum icin GET /v1/orders/{id}.
 */
export const reservationSchema = z.object({
  /** Rezervasyonun ve ondan dogacak siparisin ORTAK kimligi. */
  orderId: idSchema,
  status: orderStatusSchema,
  /**
   * Stok kilidinin bitecegi an (UTC; T11.2). Taslak acilirken stok kilitlenir;
   * yalnizca kilitsiz eski taslakta yoktur.
   */
  expiresAt: isoDateTimeSchema.optional(),
  /**
   * Kilidin kalan saniyesi, SUNUCUNUN saatiyle (T11.4): istemcinin saati kaysa
   * da geri sayim bundan baslar. expiresAt ile birlikte gelir; dolmussa 0.
   */
  ttlSeconds: z.number().int().min(0).optional(),
});

/**
 * Rezervasyon serbest birakma cevabi (DELETE /v1/cart/reserve/{orderId}, T11.4).
 *
 * released alani false olabilir ve bu HATA DEGILDIR: rezervasyon zaten
 * birakilmis (kullanici iptali ya da suresi dolup supurucu toplamis); o zaman
 * releasedAt o andir. Istemci her iki durumda da sepeti tazeler.
 */
export const reservationReleaseSchema = z.object({
  orderId: idSchema,
  released: z.boolean(),
  releasedAt: isoDateTimeSchema,
});

export type CartItemInput = z.infer<typeof cartItemInputSchema>;
export type DeliveryAddress = z.infer<typeof deliveryAddressSchema>;
export type SavedAddress = z.infer<typeof savedAddressSchema>;
export type AddressKind = z.infer<typeof addressKindSchema>;
export type CreateAddressRequest = z.infer<typeof createAddressRequestSchema>;
export type SavedAddressList = z.infer<typeof savedAddressListSchema>;
export type ReserveCartRequest = z.infer<typeof reserveCartRequestSchema>;
export type ReservationLine = z.infer<typeof reservationLineSchema>;
export type Reservation = z.infer<typeof reservationSchema>;
export type ReservationRelease = z.infer<typeof reservationReleaseSchema>;
