# @getir/order-service

Sipariş gerçeğinin ve checkout saga'sının **tek sahibi** (ADR-05): `orders` ve `outbox`
koleksiyonları. Sipariş durumunu **yazabilen tek yer** burasıdır; başka servis durumu
değiştiremez, yalnızca bu servisin RPC'lerini çağırır.

Bu serviste **olmayanlar**, bilinçli: stok sayacı `inventory-service`'in, kart çekimi
`payment-service`'in, skor hesabı `risk-service`'in işidir. Risk **bandının aksiyonu** ise
(kapıda ödeme kapalı, rezervasyon süresi, reddet) burada verilir — risk servisi yalnızca
skor önerir.

## Bugünkü durum (T7.2 — sunucu tarafı fiyat)

| RPC                | Durum                                                                                                              |
| ------------------ | ------------------------------------------------------------------------------------------------------------------ |
| `CreateDraftOrder` | ✅ Fiyatı catalog'dan okur, sunucuda hesaplar, `expected_total` ile karşılaştırır; tutarı taslakta dondurur (T7.2) |
| `CreateOrder`      | ✅ Tablodan adım adım: `DRAFT → RISK_CHECK → RESERVED → AWAITING_PAYMENT`                                          |
| `GetOrder`         | ✅ Tek sipariş, zaman çizelgesi dahil; başkasının siparişi `NOT_FOUND`                                             |
| `ListMyOrders`     | ✅ Yeniden eskiye, imleçle sayfalı; sipariş yoksa boş liste                                                        |
| `CancelOrder`      | ✅ Kullanıcı iptali: yalnızca `DRAFT`, `RESERVED`, `AWAITING_PAYMENT` (B29); Idempotency-Key zorunlu (D4)          |

## Veri kaynağı: Mongo ya da MOCK

| `MOCK` | Kaynak                                        | Mongo gerekir mi                 |
| ------ | --------------------------------------------- | -------------------------------- |
| `true` | Bellek (`infrastructure/memory`)              | Hayır; yeniden başlayınca unutur |
| değil  | `orders` koleksiyonu (`infrastructure/mongo`) | Evet, `MONGO_URI` zorunlu        |

İki uygulama **aynı sözleşme testinden** geçer (`test/support/order-store-contract.ts`): birim
testinde bellek, entegrasyon testinde gerçek Mongo. Depoyu seçip açan tek yer
`infrastructure/order-store.ts`'tir; indeksler açılışta kurulur.

**İki port, her use-case yalnızca ihtiyacını alır:** `OrderRepository` (`insert`, `update`,
`findById`) taslak açan, ilerleten ve iptal eden use-case'lerin; `OrderHistoryReader`
(`listByUser`) yalnızca `ListMyOrders`'ın.

**İyimser kilit (`version`).** Yeni taslak 1'dir, her geçiş bir artırır. `update(order,
expectedVersion)` yalnızca kayıttaki sürüm okunanla aynıysa yazar (Mongo'da
`replaceOne({ _id, version })`). Aynı taslağa eş zamanlı iki `CreateOrder` ya da
`CreateOrder` + `CancelOrder` gelirse ikincisi `CONFLICT` alır; "son yazan kazanır" yoktur.

**Geçmiş sırası ve imleç.** Liste `createdAt` azalan, eşitlikte kimlik azalan sıralıdır;
kimlik rastgele olduğu için tek başına zaman sırası vermez. Sayfa jetonu `(createdAt, id)`
taşır ve istemci için opaktır (`interfaces/grpc/page-token.ts`). Offset yerine imleç: kullanıcı
listeyi gezerken yeni sipariş verirse offset kayar. Sayfa boyutu sözleşme sınırlarına
oturtulur (0 → 20, 100 üstü → 100); bu sınırlar REST ile aynı yerden, `@getir/contracts`'tan
gelir.

| Koleksiyon | İndeks                                                          | Sorgu          |
| ---------- | --------------------------------------------------------------- | -------------- |
| `orders`   | `{ userId: 1, createdAt: -1, _id: -1 }` (`userId_createdAt_id`) | `ListMyOrders` |

Roadmap veri modelindeki `status` indeksi, durumu sorgulayan ilk iş (rezervasyon süpürücüsü,
T11.x) geldiğinde eklenir: bugün onu kullanan sorgu yok, gereksiz indeks her yazımı
pahalılaştırır.

**Bilerek boş bırakılanlar:** proto `Order`'daki fiyatlı kalemler (`items`) ve tutarlar
(`subtotal`, `total`…) boş döner. Sipariş bugün ham sepet satırı taşır; fiyatın dondurulması
katalog teklifleri toplu okununca (T9.3) ve pricing bağlanınca gelir. "0 TL" yazmak
istemciye yanlış tutar gösterirdi. `dark_store_id` okunmaz (ADR-15); `market_id` zorunlu
ve `mkt_` biçimlidir.

### Durum makinesi (`src/domain/order-state-machine.ts`)

Her geçiş tek bir tablodan geçer (`ORDER_TRANSITIONS`, roadmap diyagramı + B20 + B29); tabloda
olmayan geçiş `ORDER_STATE_INVALID` fırlatır (gRPC `FAILED_PRECONDITION`) ve ayrıntıda
`{ orderId, from, to }` taşır. Durumu değiştirmenin tek yolu `transitionOrder`'dır: tabloyu
kontrol eder ve `timeline[]`'a bir kayıt **ekler** (durum, zaman, isteğe bağlı not anahtarı).
Tablo `Record<OrderStatus, …>`: `@getir/core`'a yeni durum eklenip tabloya eklenmezse derleme
kırılır. Testi tabloyu diyagramdaki kenar listesiyle **birebir** karşılaştırır; ayrıca her durum
`DRAFT`'tan erişilebilir ve her ara durumdan bir son duruma varılabilir.

**Geçici adımlar, görünür:** risk servisi (T6.3) ve stok rezervasyonu (T11.2) henüz bağlı değil.
`CreateOrder` bu iki adımı yine tablodan geçer ama zaman çizelgesine nedeniyle yazar
(`PENDING_RISK_SERVICE`, `PENDING_RESERVATION`) — sessizce atlanmaz. Saga gelince (T7.1, T11.2)
yerlerini gerçek çağrılar alır; tablo ve zaman çizelgesi değişmez.

**Kullanıcı iptali (B29):** kullanıcı yalnızca `DRAFT`, `RESERVED` ve `AWAITING_PAYMENT`
durumundaki **kendi** siparişini iptal edebilir (`USER_CANCELLABLE`). `PAID → CANCELLED` tabloda
var ama sistemin telafi adımıdır (iade, B20c). Gerekçe bir anahtardır (`CHANGED_MIND`); yoksa
`USER_CANCELLED` yazılır. Rezervasyonun serbest bırakılması T11.2'de saga'ya eklenir.

Tutar hesabı `@getir/pricing` ile T7.2'de bağlanır.

## Neden `CreateDraftOrder` de bu görevde

Görev tanımı `CreateOrder` diyor, ama `CreateOrderRequest` bir `order_id` bekler: kimliği
üreten uç `CreateDraftOrder`'dır (B8 — "rezervasyon, henüz olmayan bir siparişin kimliğiyle
açılamaz"). "grpcurl ile orderId döner" ölçütünü karşılayan uç budur; ikisi birlikte
olmadan zincir denenemezdi.

## İki karar

**Başkasının siparişinde `NOT_FOUND`, `PERMISSION_DENIED` değil.** Sözleşmede yazılı:
"bu kimlikte bir sipariş var" bilgisi bile sızdırılmamalıdır. Yetki hatası dönmek, sipariş
kimliklerini deneyerek varlık taraması yapmayı mümkün kılardı.

**Idempotency anahtarı bugünden zorunlu (ADR-08).** Üç mutasyon da (`CreateDraftOrder`,
`CreateOrder`, `CancelOrder`) anahtar ister; servis yalnızca varlığını ve uzunluğunu (8–128,
`@getir/contracts`) doğrular. Tekrar koruması (`idem:{key}`, aynı anahtara ilk cevabın
dönmesi) ADR-08 gereği gateway'dedir ve T8.2'de gelir. Erken zorunlu tutmanın sebebi:
istemciler göndermeye bugün alışsın, koruma açıldığında sözleşme değişmesin.

## Sunucu tarafı fiyat (T7.2)

Tutar istemciye güvenilmeden sunucuda hesaplanır ve **taslakta dondurulur**; `CreateOrder` ve
saga (T7.1) yeniden hesaplamaz, kullanıcı rezervasyon boyunca gördüğü fiyattan öder.

1. **Catalog'dan tek seferde:** `GetMarket` (minimum sepet, teslimat ücreti, ücretsiz eşik) ve
   `BatchGetOffers` (sepetteki ürünlerin o marketteki fiyatları, N+1 yok) paralel çağrılır.
   İsteğin `x-request-id`'si catalog'a **aynen** gider; çağrının süre sınırı 2 sn
   (`CATALOG_CALL_TIMEOUT_MS`). Adres `CATALOG_GRPC_ADDR` (gateway'le aynı değişken).
2. **Hesap web'le aynı fonksiyon:** `@getir/pricing` `calculateCart`. ILK10'un "ilk sipariş mi"
   sorusunu order kendi kaydından cevaplar (`hasPaidOrder`, yalnızca kupon girildiyse).
3. **Kontrol sırası ve hatalar** (hiçbirinde taslak açılmaz):

| Durum                                      | Kod (gRPC)                                 | Ayrıntı                                    |
| ------------------------------------------ | ------------------------------------------ | ------------------------------------------ |
| Ürün o markette satılmıyor / sku uyuşmuyor | `VALIDATION_FAILED` (INVALID_ARGUMENT)     | `unavailableProductIds`, `skuMismatch…`    |
| Kupon uygulanamadı                         | `COUPON_INVALID`                           | `couponCode`, `reason`                     |
| Minimum sepet altı                         | `MIN_BASKET_NOT_MET` (FAILED_PRECONDITION) | `amountToMinBasketMinor`, `minBasketMinor` |
| `expected_total` sunucunun toplamı değil   | `PRICE_CHANGED` (ABORTED)                  | `expectedTotalMinor`, `totalMinor`         |
| Catalog'a ulaşılamadı / süre doldu         | `SERVICE_UNAVAILABLE` (UNAVAILABLE)        | —                                          |

## Katmanlar

```text
src/
├── domain/            # saf iş kuralı — mongodb/grpc/proto importu YOK
│   ├── order.ts                 # Order, createDraftOrder, transitionOrder (timeline + version)
│   ├── order-item.ts            # dondurulmuş kalem (OrderItem) ve tutar (OrderPricing)
│   ├── price-draft.ts           # saf fiyat kuralı: priceDraft, assertExpectedTotal (T7.2)
│   ├── order-state-machine.ts   # geçiş tablosu, USER_CANCELLABLE
│   ├── order-repository.ts      # port: insert / update(sürümlü) / findById + hataları
│   ├── order-history-reader.ts  # port: listByUser (sayfalı geçmiş), hasPaidOrder (ILK10)
│   └── order-history-cursor.ts  # geçmiş sırası ve imleç
├── application/       # bir dosya = bir use-case
│   ├── create-draft-order.ts, create-order.ts, cancel-order.ts
│   ├── get-order.ts, list-my-orders.ts
│   ├── catalog-pricing.ts       # port: marketRules, activeOffers (T7.2)
│   └── request-scope.ts         # use-case'e taşınan requestId + çağrının logger'ı
├── infrastructure/
│   ├── order-store.ts           # MOCK ya da Mongo: depoyu açar, kapanışı verir
│   ├── catalog/                 # order -> catalog gRPC istemcisi (service-kit callUnary)
│   ├── memory/                  # MOCK: bellek deposu
│   └── mongo/                   # belge şekli, çeviriciler, sorgular (orders-collection), portlar
├── interfaces/grpc/   # ince handler'lar: doğrula → çağır → çevir
│   ├── schemas.ts     # Zod istek şemaları (sayfa boyutu kırpma, jeton çözme)
│   ├── page-token.ts  # imleç ↔ opak sayfa jetonu
│   ├── mappers.ts     # domain → proto (durum, Order)
│   └── order-handlers.ts
├── config/            # env.ts (process.env yalnızca burada) + constants.ts
├── bootstrap.ts
├── main.ts
└── healthcheck.ts
```

Zaman `Clock` soyutlaması üzerinden okunur — `Date.now()` iş mantığında çağrılmaz, böylece
testte saat sabitlenebilir.

## Çalıştırma ve doğrulama

```bash
pnpm --filter @getir/order-service build
MOCK=true pnpm --filter @getir/order-service start    # 50053, Mongo'suz (bellek)

pnpm infra:up                                         # ya da Mongo ile:
MONGO_URI="mongodb://localhost:27017/getir?directConnection=true" \
  pnpm --filter @getir/order-service start
```

```bash
# 1) Taslak aç → orderId
grpcurl -plaintext -import-path packages/proto/proto -proto getir/order/v1/order.proto \
  -d '{"user_id":"usr_1","market_id":"mkt_migros-jet-moda",
       "lines":[{"product_id":"prd_bulasik-deterjan","sku":"BULASIK-DETERJAN","quantity":2},
                {"product_id":"prd_cikolata-80","sku":"CIKOLATA-80","quantity":1}],
       "delivery_location":{"lat":40.99,"lng":29.02},
       "delivery_address":"Kadıköy","idempotency_key":"4f1c3a2b-9d8e",
       "expected_total":{"amount_minor":19360,"currency":"TRY"}}' \
  localhost:50053 getir.order.v1.OrderService/CreateDraftOrder
# seed fiyatlarıyla: 2 x 67,90 + 32,90 = 168,70 + 24,90 teslimat = 193,60 TL.
# Farklı toplam gönderirsen ABORTED + PRICE_CHANGED (ayrıntıda doğru toplam).
# catalog-service (50051) ayakta olmalı: fiyatlar oradan okunur.

# 2) Siparişe çevir → AWAITING_PAYMENT
grpcurl -plaintext -import-path packages/proto/proto -proto getir/order/v1/order.proto \
  -d '{"order_id":"<1. adımdan>","user_id":"usr_1","idempotency_key":"4f1c3a2b-9d8e"}' \
  localhost:50053 getir.order.v1.OrderService/CreateOrder

# 3) Geçmiş → en yeni sipariş başta; Mongo modunda Compass'ta getir.orders altında da görünür
grpcurl -plaintext -import-path packages/proto/proto -proto getir/order/v1/order.proto \
  -d '{"user_id":"usr_1","page":{"page_size":10}}' \
  localhost:50053 getir.order.v1.OrderService/ListMyOrders

# 4) İptal → CANCELLED (anahtarsız istek INVALID_ARGUMENT)
grpcurl -plaintext -import-path packages/proto/proto -proto getir/order/v1/order.proto \
  -d '{"order_id":"<1. adımdan>","user_id":"usr_1","reason":"CHANGED_MIND","idempotency_key":"9a8b7c6d-5e4f"}' \
  localhost:50053 getir.order.v1.OrderService/CancelOrder
```

Aynı akışın otomatik karşılığı `test/unit/grpc/*.spec.ts` (bellek, RPC başına bir dosya) ve
`test/integration/mongo-order-store.spec.ts` (gerçek Mongo: sözleşme, indeks planı, gRPC →
`orders` belgesi).

## Docker

```bash
docker build -f apps/order-service/Dockerfile -t getir/order-service .
docker run --rm -p 50053:50053 -e MOCK=true getir/order-service
```

Çok aşamalı imaj, `node` kullanıcısı, `grpc.health.v1` ile `HEALTHCHECK`. Ayrıntılı gerekçe
catalog-service README'sinde; iki Dockerfile bilinçli olarak birbirinin eşidir.
