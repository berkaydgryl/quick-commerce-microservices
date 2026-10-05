/**
 * Sozlesme sabitleri.
 *
 * Buradaki degerler REST ve socket yuzeyinin bir parcasidir: uzunluk sinirlari,
 * sayfa boyutu esikleri ve bicim desenleri. Tek kaynak burasidir ve
 * docs/api/openapi.yaml ile birebir ayni olmak zorundadir.
 *
 * NEDEN @getir/core'da DEGIL: core, protokolden bagimsiz cekirdek yapi
 * taslarini tutar (hata kodlari, siparis durumlari, sku bicimi). Bir
 * sifrenin en fazla kac karakter olacagi ise HTTP yuzeyine ait bir karardir ve
 * yalnizca bu paketi ilgilendirir. Servisler arasi paylasilan is sabitleri
 * (ORDER_STATUS, SKU_PATTERN, ERROR_CODES) core'dan import edilir, burada
 * TEKRAR EDILMEZ.
 */

/**
 * Telefon: E.164, yalnizca Turkiye ve yalnizca CEP numarasi (ADR-12; T11.9).
 * BTK numaralandirma plani: cep numarasi "5XX" + 7 rakam, ulke kodundan sonra
 * 10 rakam ve ilk rakam 5 (2XX-4XX sabit hat, 8XX/9XX servis numaralari;
 * SMS ve kurye aramasi icin cep gerekir). Operator onekleri (53X, 54X, 55X...)
 * tek tek listelenmez: BTK yeni blok actikca liste eskirdi, numara tasima
 * oneki operatorden ayirdi.
 */
export const PHONE_PATTERN = /^\+905[0-9]{9}$/;

/** Cep numarasinin ilk rakami (PHONE_PATTERN): form, yanlis ilk rakami yazilir yazilmaz uyarir. */
export const PHONE_MOBILE_PREFIX = '5';

/** Tek kullanimlik kod: tam 6 rakam (3DS; T11.14'ten beri e-posta dogrulama kodu da). */
export const OTP_PATTERN = /^[0-9]{6}$/;

/**
 * Sifre uzunlugu. Alt sinir KARAKTER, ust sinir BAYT: bcrypt girdinin ilk 72 baytini
 * kullanir (auth.ts, passwordSchema).
 */
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 72;

/** Ad soyad. */
export const FULL_NAME_MIN_LENGTH = 2;
export const FULL_NAME_MAX_LENGTH = 80;

/** Serbest metin urun aramasi. Tek karakterlik sorgu tum katalogu tarardi. */
export const SEARCH_QUERY_MIN_LENGTH = 2;
export const SEARCH_QUERY_MAX_LENGTH = 64;

/**
 * Genel aramada (T9.6) market basina donen en fazla urun. Fazlasi sayilir
 * (totalProductMatches); istemci "+N urun daha" ile market sayfasina gecer.
 * catalog-service bu sabitle keser (MAX_SEARCH_OFFERS_PER_MARKET).
 */
export const SEARCH_RESULT_PRODUCTS_MAX = 3;

/**
 * WGS84 koordinat sinirlari (derece). openapi.yaml GeoPoint ve nearby sorgusu
 * ayni araligi yazar; mesajlar da bu sabitlerden uretilir, sayi iki kez yazilmaz.
 */
export const LATITUDE_MIN = -90;
export const LATITUDE_MAX = 90;
export const LONGITUDE_MIN = -180;
export const LONGITUDE_MAX = 180;

/** Sepet sinirlari. */
export const CART_ITEM_MIN_QUANTITY = 1;
export const CART_ITEM_MAX_QUANTITY = 99;
export const CART_MIN_ITEMS = 1;
export const CART_MAX_ITEMS = 50;

/** Adres metinleri. */
export const ADDRESS_LINE_MAX_LENGTH = 240;
export const ADDRESS_NOTE_MAX_LENGTH = 240;

/**
 * Adres defterinin ust siniri (T9.5). Adres defteri kullanicinin urettigi bir
 * listedir; sayfalanmaz, SINIRLIDIR (proje kurallari, "Sinirli listeler
 * istisnasi"): yazan her yol (persona seed'i; ileride adres ekleme ucu) siniri
 * asan kaydi reddeder, okuma da siniri uygular. Gateway'deki karsiligi
 * auth.MaxSavedAddresses (rules_contract_test esitligini denetler).
 */
export const SAVED_ADDRESSES_MAX = 10;

/**
 * Kullanici basina en fazla favori market (T11.13). Favori listesi sinirlidir,
 * sayfalanmaz (adres defteri gibi). Gateway'deki karsiligi favorites.MaxMarkets,
 * catalog'un toplu okuma siniri MAX_BATCH_MARKET_IDS (iki esitlik testlerle).
 */
export const FAVORITE_MARKETS_MAX = 50;

/**
 * E-posta adresi (T11.14): profilde DOGRULANARAK eklenen iletisim alani; kimlik
 * degildir, giris yine telefon + sifredir (ADR-12 eki). 254, RFC 5321'in yol
 * siniridir. Desen bilincli olarak sadedir (tek @, iki yanda bosluksuz metin,
 * alan adinda nokta): adresin gercek oldugunu bicim degil, gonderilen kod
 * kanitlar. Gateway ayni deseni uygular (emailverify; contract_test esitligini
 * denetler); Zod'un .email() kurali Go'da birebir yazilamazdi.
 */
export const EMAIL_MAX_LENGTH = 254;
export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Dogrulama kodu (T11.14, kullanicinin karari A2; e-posta PR 1, telefon PR 3
 * ayni kurali uygular): 6 rakam (OTP_PATTERN), 10 dakika gecerli, 5 yanlis
 * denemede iptal, yeni kod en erken 60 saniye sonra. Gateway'deki karsiliklari
 * verification paketinde (contract_test).
 */
export const VERIFICATION_CODE_TTL_SECONDS = 600;
export const VERIFICATION_CODE_MAX_ATTEMPTS = 5;
export const VERIFICATION_CODE_RESEND_SECONDS = 60;

/**
 * Kupon kodunun en uzun hali (ornek: ILK10). Bilinmeyen kod zaten
 * COUPON_INVALID alir; sinir, sinirsiz metnin kapidan gecmemesi icindir.
 * REST rezervasyon govdesi ve order-service'in gRPC semasi ayni degeri
 * kullanir (T7.5); iki kapida iki sinir olmasin.
 */
export const COUPON_CODE_MAX_LENGTH = 32;

/**
 * Idempotency anahtari (ADR-08). Sinirlar @getir/core'da tanimlidir, cunku
 * ayni kurali REST basligi disinda servislerin gRPC semalari ve redis-kit'in
 * idem:{key} anahtari da uygular. Burada yalnizca yeniden disa verilir ki REST
 * yuzeyinin sinirlari tek pakette okunsun; deger burada TEKRAR YAZILMAZ.
 */
export {
  IDEMPOTENCY_KEY_CHARSET,
  IDEMPOTENCY_KEY_MAX_LENGTH,
  IDEMPOTENCY_KEY_MIN_LENGTH,
} from '@getir/core';

/**
 * Iade gerekcesi ANAHTARI (metin degil; ornek "order_changed_during_payment").
 * payment'in Refund RPC'si ve payment.refund_requested olayi ayni kurali
 * uygular (T7.4); kayda ve olaya oldugu gibi yazilir, gosterimde cevrilir.
 */
export const REFUND_REASON_MAX_LENGTH = 64;
export const REFUND_REASON_PATTERN = /^[a-z0-9_]+$/;

/**
 * Rezervasyonu birakma gerekcesi ANAHTARI (T10.2; inventory.proto
 * ReleaseRequest.reason): ornek "user_cancelled", "risk_rejected",
 * "payment_failed". Iade gerekcesiyle ayni kural; stok defterine oldugu gibi
 * yazilir, gosterimde cevrilir. Kapali liste degil: yeni gerekce stok
 * servisini degistirmeden eklenebilir.
 */
export const RELEASE_REASON_MAX_LENGTH = 64;
export const RELEASE_REASON_PATTERN = /^[a-z0-9_]+$/;

/**
 * Sayfalama.
 *
 * Sinir disi pageSize REDDEDILMEZ, ust sinira KIRPILIR. Gerekce: ayni davranis
 * gRPC tarafinda da gecerli (getir.common.v1.PageRequest) ve istemciye
 * "101 yerine 100 iste" demek yerine sessizce dogru olani vermek, sonsuz
 * kaydirma yapan bir arayuzde gereksiz hata ekrani uretmez.
 */
export const PAGE_SIZE_DEFAULT = 20;
export const PAGE_SIZE_MIN = 1;
export const PAGE_SIZE_MAX = 100;

/**
 * Gecmis Siparislerim (T11.16; GET /v1/orders): varsayilan ve en buyuk sayfa.
 * Ust sinir katalogun BatchGetMarkets siniridir (50): sayfanin market adlari
 * tek cagriya sigar. Gateway'deki karsiliklari orderhistory paketindedir
 * (contract_test.go).
 */
export const ORDER_HISTORY_PAGE_SIZE_DEFAULT = 20;
export const ORDER_HISTORY_PAGE_SIZE_MAX = 50;

/** Socket oda adi onekleri (docs/api/socket-events.md). */
export const ROOM_PREFIX = {
  /** Yalnizca siparis sahibi girebilir; oda jetonu sarttir. */
  order: 'order:',
  /** Herkese acik; yalnizca stock.changed tasir. */
  store: 'store:',
} as const;

/**
 * Katalog kimliklerinin onekleri (ADR-15).
 *
 * Katalog kimlikleri seed ile gelir ve OKUNABILIRDIR: "mkt_migros-jet-moda",
 * "prd_sut-1l". Calisma aninda uretilen kimlikler (siparis, kullanici) ise
 * @getir/core ID_PREFIX + 32 onaltilik karakterdir; ikisi farkli kaynaktir ve
 * farkli dogrulanir.
 */
export const CATALOG_ID_PREFIX = {
  MARKET: 'mkt',
  PRODUCT: 'prd',
  CATEGORY: 'cat',
  OFFER: 'ofr',
} as const;

/** Onekten sonraki govde: kucuk harf, rakam ve tekli tire ("migros-jet-moda"). */
export const CATALOG_ID_BODY_PATTERN = '[a-z0-9]+(?:-[a-z0-9]+)*';

/** Katalog kimliginin en uzun hali; yol parametresi olarak URL'de tasinir. */
export const CATALOG_ID_MAX_LENGTH = 64;

/**
 * Oda adinin en uzun hali: en uzun onek (store:) + en uzun katalog kimligi.
 * Siparis odasi (order: + 36 karakter) her zaman bunun altindadir. Sinir, oda
 * adini istemciden alan sunucuyu (realtime) uzun metni ayristirmaktan korur.
 */
export const ROOM_NAME_MAX_LENGTH = ROOM_PREFIX.store.length + CATALOG_ID_MAX_LENGTH;

/** Market puani araligi (sabit seed verisi; yorum sistemi kapsam disi). */
export const RATING_MIN = 0;
export const RATING_MAX = 5;

/**
 * Icerik uclari (T11.6): ekrandaki metin ve gorseller koddan degil sunucudan
 * gelir. Sinirlar icerik dosyasinin (gateway internal/content) acilista
 * dogrulanmasi icindir; gateway'deki karsiliklari content.MaxTextLength,
 * content.MaxBannerSources ve content.MaxPhoneCountries (esitligi Go testi
 * denetler).
 */
export const CONTENT_TEXT_MAX_LENGTH = 200;

/** Banner gorselinin en fazla boy sayisi (srcset). */
export const CONTENT_BANNER_SOURCES_MAX = 4;

/**
 * Ulke kodu secicisinin en fazla satiri. Telefon kurali (PHONE_PATTERN) bugun
 * yalnizca +90 kabul eder; listeye baska ulke eklemek o kurali da degistirir.
 */
export const CONTENT_PHONE_COUNTRIES_MAX = 10;

/** Ulke telefon kodu: "+" ve 1-3 rakam, sifirla baslamaz ("+90"). */
export const DIAL_CODE_PATTERN = /^\+[1-9][0-9]{0,2}$/;

/** Ulke kodu: ISO 3166-1 alfa-2, buyuk harf ("TR"). */
export const COUNTRY_CODE_PATTERN = /^[A-Z]{2}$/;

/**
 * Karsilama ekraninin tanitim bolumleri (T11.7): uygulama indirme bandindaki
 * magaza rozetleri ve alttaki tanitim kutulari. Gateway'deki karsiliklari
 * content.MaxStoreLinks ve content.MaxFeatures.
 */
export const CONTENT_STORE_LINKS_MAX = 4;
export const CONTENT_FEATURES_MAX = 6;

/**
 * Adres penceresindeki haritanin baslangic yakinlastirmasi (T11.8):
 * OpenStreetMap karolari 0-19 arasidir; 0 butun dunyadir, ise yaramaz.
 * Gateway'deki karsiliklari content.MinMapZoom ve content.MaxMapZoom.
 */
export const CONTENT_MAP_ZOOM_MIN = 1;
export const CONTENT_MAP_ZOOM_MAX = 19;

/**
 * Adres ekleme (T11.8; POST /v1/me/addresses): kayitli adresin adi ("Ev", "Is")
 * ve bina, kat, daire alanlari (kisa serbest metin: "19C3", "3", "12").
 * Gateway'deki karsiliklari auth.AddressTitleMaxLength ve
 * auth.AddressUnitMaxLength (esitligi rules_contract_test denetler).
 */
export const ADDRESS_TITLE_MAX_LENGTH = 40;
export const ADDRESS_UNIT_MAX_LENGTH = 20;

/**
 * Adres aramasi (T11.8; GET /v1/geo/search): en kisa ve en uzun sorgu, en
 * fazla sonuc. Gateway'deki karsiliklari geo paketindedir.
 */
export const GEO_SEARCH_QUERY_MIN_LENGTH = 3;
export const GEO_SEARCH_QUERY_MAX_LENGTH = 100;
export const GEO_SEARCH_RESULTS_MAX = 5;
