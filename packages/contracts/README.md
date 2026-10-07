# @getir/contracts

Tarayıcıya açılan yüzeyin **tek doğruluk kaynağı**: REST gövdeleri, socket olay
payload'ları, ortak cevap zarfı ve hata kodlarının Türkçe karşılıkları. Hepsi Zod
şeması olarak yazılır; TypeScript tipleri `z.infer` ile şemadan türer (ADR-10).

Sınır net: **servisten servise senkron** konuşma (gRPC) buraya girmez, o `packages/proto`
içindeki `.proto` dosyalarındadır. **Tek istisna asenkron olay gövdeleridir** (T7.4,
`events.ts`): `stream:events`'teki zarfın `payload` alanının proto karşılığı yoktur; üreten
servis gövdeyi bu tipten kurar, tüketen servis aynı şemadan geçirir, ayrışma derlemede ya da
sözleşme testinde yakalanır. Zarfın kendisi `@getir/event-bus`'tadır. Burada olmasının bir
sebebi de bağımlılık yönüdür: üreten servisin `domain/` katmanı tipi saf bir paketten alır,
Redis taşıyan olay paketinden değil. Bu pakette ayrıca **iş mantığı yoktur** — fiyat hesabı,
risk kararı ya da durum geçişi burada bulunmaz. Tek cevapladığı soru: "bu ucun gövdesi neye
benziyor?"

## Klasör düzeni

```text
packages/contracts/
├── src/
│   ├── constants.ts   # uzunluk sınırları, desenler, sayfa boyutu eşikleri
│   ├── common.ts      # Money, GeoPoint, Page, id, ISO zaman
│   ├── envelope.ts    # ApiResponse zarfı, ApiError, apiOk / apiFail
│   ├── errors.ts      # ErrorCode -> Türkçe kullanıcı mesajı
│   ├── auth.ts        # register, login, oturum, profil
│   ├── catalog.ts     # kategori, ürün, karanlık mağaza
│   ├── content.ts     # ekran metinleri ve görselleri: yalnızca content/ bloklarını dışa aktarır (D18)
│   ├── content/       # ekran başına bir blok: banner, giriş kartı, uygulama indirme, adres penceresi,
│   │                  #   üst bar, market listesi, favoriler, profil, Adreslerim, siparişler, hesap menüsü,
│   │                  #   Ödeme Yöntemlerim, karşılama kökü (welcome); ortak metin ve görsel adresi
│   ├── geo.ts         # harita adres çözümleme ve arama (T11.8)
│   ├── cart.ts        # sepet girdisi, rezervasyon, serbest bırakma, adres defteri ve ekleme
│   ├── order.ts       # sipariş, adres, 3DS, kurye özeti; kayıtlı kartla ödeme (T12.4)
│   ├── checkout-rules.ts  # sipariş ayrıntıları (T12.4): hediye, not, zili çalma, sözleşme onayı; sınırlar ve cümleler
│   ├── card-rules.ts  # kart kasası kuralları (T11.17): marka, Luhn, CVV, son kullanma, ad, kart adı; alan cümleleri
│   ├── cards.ts       # kart kasası şemaları (T11.17): ekleme isteği, maskeli kart ve liste
│   ├── socket.ts      # oda adları, olay payload'ları, olay sözlüğü
│   ├── events.ts      # servisler arası olay gövdeleri (payment.refund_requested T7.4, payment.cancel_requested T11.2)
│   └── index.ts
└── test/unit/
```

## Cevap zarfı

Gateway'den çıkan her cevap tek bir zarftadır. Hata bilgisi **gruplanmıştır**:

```json
{
  "success": false,
  "error": {
    "code": "STOCK_INSUFFICIENT",
    "message": "Bu üründen yeterli stok kalmadı.",
    "details": { "sku": "SUT-1L", "requested": "3", "available": "1" },
    "requestId": "req_8f2a"
  }
}
```

Kökte ayrıca bir `message` alanı **yoktur**. İki gerekçe: hatanın tamamı tek parça
halinde taşınabiliyor (toast'a, log'a olduğu gibi verilir) ve `getir.common.v1.ErrorDetail`
de aynı şekilde gruplu olduğu için gateway'in gRPC hatasını REST'e çevirmesi alan taşıma
değil neredeyse birebir eşleme oluyor.

`data` uca göre değiştiğinden zarf şemaları birer **fabrikadır**:

```ts
const schema = apiResponseSchema(productSchema.array());
```

## Neyin sahibi kim

| Konu                                     | Sahip                          | Not                                                       |
| ---------------------------------------- | ------------------------------ | --------------------------------------------------------- |
| Hata **kodları**, HTTP/gRPC karşılıkları | `@getir/core` → `ERROR_CODES`  | Burada tekrar tanımlanmaz                                 |
| Hata **mesajları** (Türkçe)              | bu paket → `ERROR_MESSAGES`    | `Record<ErrorCode, string>`; eksik çeviri derlemeyi kırar |
| Sipariş durumları                        | `@getir/core` → `ORDER_STATUS` | `orderStatusSchema` bunu sarar                            |
| SKU biçimi                               | `@getir/core` → `SKU_PATTERN`  | `skuSchema` bunu sarar                                    |
| REST yolları ve örnekleri                | `docs/api/openapi.yaml`        | Alan adları bu paketle birebir aynı                       |
| Socket olayları                          | `docs/api/socket-events.md`    | Payload'lar bu paketle birebir aynı                       |

## İki farklı `Product` var, bilerek

`getir.catalog.v1.Product` mesajında **stok alanı yoktur** (B27); buradaki
`productSchema` ise `availableQuantity` alanını **taşıyabilir**. Sebep: katalog verisi
catalog-svc'den, adet inventory-svc'den gelir ve gateway ikisini birleştirerek istemciye
tek görünüm sunar. İstemcinin iki ayrı çağrı yapıp elde birleştirmesi istenmiyor.

Alan **isteğe bağlıdır**: yokluğu "stok bilgisi yok" demektir, "0" değil (inventory bağlanana
kadar hep yok). `isActive` ise **zorunludur** (T7.6): liste pasif teklifi de döndürür ve
istemci "satışta değil"i "bilinmiyor"dan ayırabilmelidir.

## Gateway neden bu paketi import etmiyor

Gateway Go ile yazılıyor, dolayısıyla bir TypeScript paketini kullanamaz. Aynı sözleşmeyi
`docs/api/openapi.yaml` üzerinden izler ve iki yüzey **elle** hizalı tutulur. Bu, ADR-09'da
açıkça kabul edilmiş bir borçtur: bir alan değişecekse önce bu paket ve `openapi.yaml`
birlikte güncellenir, sonra uygulamalar takip eder.

## Alan adları neden proto ile aynı

`amountMinor`, `nextPageToken`, `lat`/`lng` gibi adlar protobuf'un resmi JSON eşleme
kuralıyla (`amount_minor` → `amountMinor`) birebir örtüşecek şekilde seçildi. Böylece
gateway camelCase'e çevirmekten başka bir dönüşüm yapmıyor; arada isim eşleme tablosu
tutulmuyor ve bir gün biri değiştiğinde diğerinin sessizce `undefined` okuması riski
ortadan kalkıyor.
