# @getir/order-service

Sipariş gerçeğinin ve checkout saga'sının **tek sahibi** (ADR-05): `orders` ve `outbox`
koleksiyonları. Sipariş durumunu **yazabilen tek yer** burasıdır; başka servis durumu
değiştiremez, yalnızca bu servisin RPC'lerini çağırır.

Bu serviste **olmayanlar**, bilinçli: stok sayacı `inventory-service`'in, kart çekimi
`payment-service`'in, skor hesabı `risk-service`'in işidir. Risk **bandının aksiyonu** ise
(kapıda ödeme kapalı, rezervasyon süresi, reddet) burada verilir — risk servisi yalnızca
skor önerir.

## Bugünkü durum (T7.1 — sipariş saga'sı: risk + ödeme)

| RPC                | Durum                                                                                                                          |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| `CreateDraftOrder` | ✅ Fiyatı catalog'dan okur, sunucuda hesaplar, `expected_total` ile karşılaştırır; tutarı taslakta dondurur (T7.2)             |
| `CreateOrder`      | ✅ Saga (T7.1): risk-svc → bant kararı → payment-svc çekimi; `PAID`, `PAYMENT_FAILED`, 3DS beklemesi ya da `REVIEW`/`REJECTED` |
| `ConfirmPayment`   | ✅ 3DS kodu (T7.1): doğruysa `PAID`; hak biter / süre dolarsa `PAYMENT_FAILED`                                                 |
| `GetOrder`         | ✅ Tek sipariş, zaman çizelgesi dahil; başkasının siparişi `NOT_FOUND`                                                         |
| `ListMyOrders`     | ✅ Yeniden eskiye, imleçle sayfalı; sipariş yoksa boş liste                                                                    |
| `CancelOrder`      | ✅ Kullanıcı iptali: yalnızca `DRAFT`, `RESERVED`, `AWAITING_PAYMENT` (B29); Idempotency-Key zorunlu (D4)                      |

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

**Geçici adım, görünür:** stok rezervasyonu (T11.2) henüz bağlı değil. `CreateOrder` bu adımı
yine tablodan geçer ama zaman çizelgesine nedeniyle yazar (`PENDING_RESERVATION`) — sessizce
atlanmaz. T11.2'de yerini gerçek çağrı alır; tablo ve zaman çizelgesi değişmez. (Risk adımının
geçici notu `PENDING_RISK_SERVICE` T7.1'de kalktı: risk artık gerçekten soruluyor.)

**Kullanıcı iptali (B29):** kullanıcı yalnızca `DRAFT`, `RESERVED` ve `AWAITING_PAYMENT`
durumundaki **kendi** siparişini iptal edebilir (`USER_CANCELLABLE`). `PAID → CANCELLED` tabloda
var ama sistemin telafi adımıdır (iade, B20c). Gerekçe bir anahtardır (`CHANGED_MIND`); yoksa
`USER_CANCELLED` yazılır. Rezervasyonun serbest bırakılması T11.2'de saga'ya eklenir.

## Neden `CreateDraftOrder` de bu görevde

Görev tanımı `CreateOrder` diyor, ama `CreateOrderRequest` bir `order_id` bekler: kimliği
üreten uç `CreateDraftOrder`'dır (B8 — "rezervasyon, henüz olmayan bir siparişin kimliğiyle
açılamaz"). "grpcurl ile orderId döner" ölçütünü karşılayan uç budur; ikisi birlikte
olmadan zincir denenemezdi.

## İki karar

**Başkasının siparişinde `NOT_FOUND`, `PERMISSION_DENIED` değil.** Sözleşmede yazılı:
"bu kimlikte bir sipariş var" bilgisi bile sızdırılmamalıdır. Yetki hatası dönmek, sipariş
kimliklerini deneyerek varlık taraması yapmayı mümkün kılardı.

**Idempotency anahtarı bugünden zorunlu (ADR-08).** Dört mutasyon da (`CreateDraftOrder`,
`CreateOrder`, `ConfirmPayment`, `CancelOrder`) anahtar ister; servis yalnızca varlığını ve uzunluğunu (8–128,
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

## Sipariş saga'sı (T7.1)

```text
DRAFT → RISK_CHECK → RESERVED → AWAITING_PAYMENT → PAID
                  ↘ REVIEW / REJECTED            ↘ PAYMENT_FAILED
```

**1. Risk adımı** (`application/risk-step.ts`, kurallar `domain/checkout-risk.ts`)

Order, risk-svc'ye yalnızca **sunucuda bildiklerini** gönderir (B9, istemciden sinyal alınmaz):
sepet toplamı, teslimat konumu, market, kullanıcının teslim edilen / iptal edilen sipariş sayısı
ve teslim edilenlerin ortalama sepeti (`OrderHistoryReader.riskHistory`, tek aggregation) ve
taslaktan siparişe geçen süre (checkout-dwell; T11.2'de başlangıç `reservedAt` olur). IP, cihaz,
hesap yaşı ve oturum konumunu gateway bilir; T7.5/T8'de eklenir. Eksik alan kuralı tetiklemez.

| Bant       | Sipariş                                        | Cevap                                                                       |
| ---------- | ---------------------------------------------- | --------------------------------------------------------------------------- |
| `LOW`      | devam; kapıda ödeme açık                       | —                                                                           |
| `MEDIUM`   | devam; kart + 3DS zorunlu (`require_three_ds`) | kapıda ödeme seçildiyse `PAYMENT_METHOD_NOT_ALLOWED`, sipariş `DRAFT` kalır |
| `HIGH`     | `REVIEW` (manuel inceleme)                     | `RISK_REVIEW` (REST 202)                                                    |
| `CRITICAL` | `REJECTED`                                     | `RISK_BLOCKED` (REST 403)                                                   |

Risk-svc'ye ulaşılamazsa **hiçbir şey yazılmaz**: riski atlayarak ödeme alınmaz. Bant siparişe
yazılır (`riskBand`, proto'da yok — istemciye gösterilmez).

**2. Ödeme adımı** (`application/payment-step.ts`, kurallar `domain/checkout-payment.ts`)

Sipariş önce `AWAITING_PAYMENT` olarak **kaydedilir**, sonra `Charge` çağrılır. Tutar taslakta
dondurulan toplamdır; idempotency anahtarı siparişten türetilir (`charge-<orderId>`): bir sipariş
asla iki kez çekilmez.

| Ödeme sonucu                | Sipariş                             | Cevap                             |
| --------------------------- | ----------------------------------- | --------------------------------- |
| Onay                        | `PAID`                              | —                                 |
| Kapıda ödeme (`PENDING`)    | `PAID`, not `CASH_ON_DELIVERY`      | —                                 |
| 3DS                         | `AWAITING_PAYMENT`                  | `challenge_id` → `ConfirmPayment` |
| Red / sağlayıcı hatası      | `PAYMENT_FAILED`, not hata anahtarı | `PAYMENT_DECLINED` (ya da nedeni) |
| Kartlı çekim hâlâ `PENDING` | değişmez (eş zamanlı istek sürüyor) | `REQUEST_IN_PROGRESS`             |

**Tekrar deneme:** çekim cevabı kaybolursa (payment-svc'ye ulaşılamadı) sipariş `AWAITING_PAYMENT`
kalır. Aynı `CreateOrder` tekrar gelince risk yeniden sorulmaz (kayıtlı bandın kuralı geçerli);
çekim aynı anahtarla gider, payment-svc ikinci kez çekmez.

**3. Telafi (P3):** çekim başarılı ama sipariş `PAID` yazılamadı (sürüm çakışması — örneğin
kullanıcı tam o anda iptal etti) → tutar **iade edilir** (`Refund`, anahtar `refund-<orderId>`),
istemci `CONFLICT` alır. Çakışmayı aynı ödemenin eş zamanlı tekrarı yazdıysa (sipariş zaten
`PAID`) iade yapılmaz. İade de başarısız olursa `CONFLICT` yine döner ve durum **ERROR**
günlüğüne sipariş kimliğiyle düşer; kalıcı tekrar deneme outbox ile gelir (T7.3).

**3DS onayı (`ConfirmPayment`):** kod payment-svc'ye aynen iletilir. Yanlış kodda payment-svc'nin
`THREEDS_FAILED`'ı (kalan hak, sebep) istemciye aynen döner, sipariş bekler. Hak biterse ya da
süre dolarsa sipariş önce `PAYMENT_FAILED` yazılır, hata yine aynı. Sipariş zaten `PAID` ise
(onay cevabı kaybolmuş) payment-svc'ye gidilmez, aynı sonuç döner.

Adresler `RISK_GRPC_ADDR` (varsayılan `localhost:50055`) ve `PAYMENT_GRPC_ADDR`
(`localhost:50054`); süre sınırları 1 sn ve 3 sn — toplamları gateway'in 5 sn'sinin altında.

## Katmanlar

```text
src/
├── domain/            # saf iş kuralı — mongodb/grpc/proto importu YOK
│   ├── order.ts                 # Order, createDraftOrder, transitionOrder (timeline + version)
│   ├── order-item.ts            # dondurulmuş kalem (OrderItem) ve tutar (OrderPricing)
│   ├── price-draft.ts           # saf fiyat kuralı: priceDraft, assertExpectedTotal (T7.2)
│   ├── order-state-machine.ts   # geçiş tablosu, USER_CANCELLABLE
│   ├── order-repository.ts      # port: insert / update(sürümlü) / findById + hataları
│   ├── order-history-reader.ts  # port: listByUser, hasPaidOrder (ILK10), riskHistory (T7.1)
│   ├── checkout-risk.ts         # saga risk adımı: bant → karar/politika, risk bağlamı (T7.1)
│   ├── checkout-payment.ts      # saga ödeme adımı: ödeme sonucu → sipariş, anahtarlar (T7.1)
│   └── order-history-cursor.ts  # geçmiş sırası ve imleç
├── application/       # bir dosya = bir use-case
│   ├── create-draft-order.ts, create-order.ts, confirm-payment.ts, cancel-order.ts
│   ├── get-order.ts, list-my-orders.ts
│   ├── risk-step.ts, payment-step.ts  # saga adımları (T7.1), use-case'ler paylaşır
│   ├── own-order.ts             # "kendi siparişi değilse NOT_FOUND" tek yerde
│   ├── catalog-pricing.ts       # port: marketRules, activeOffers (T7.2)
│   ├── risk-assessment.ts       # port: evaluate (T7.1)
│   ├── payments.ts              # port: charge, confirmThreeDs, refund (T7.1)
│   └── request-scope.ts         # use-case'e taşınan requestId + çağrının logger'ı
├── infrastructure/
│   ├── order-store.ts           # MOCK ya da Mongo: depoyu açar, kapanışı verir
│   ├── catalog/                 # order -> catalog gRPC istemcisi (service-kit callUnary)
│   ├── risk/, payment/          # order -> risk / payment gRPC istemcileri (T7.1)
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

# 2) Siparişe çevir (saga): risk-service (50055) ve payment-service (50054) ayakta olmalı.
#    Test kartları: tok_test_4242 onay, tok_test_0002 red, tok_test_3184 3DS.
#    Taslaktan hemen sonra (3 sn içinde) gönderirsen yeni kullanıcı MEDIUM bant alır
#    (teslimat yok 15 + bot hızı 15 = 30): 4242 bile 3DS ister, cevapta challenge_id döner.
grpcurl -plaintext -import-path packages/proto/proto -proto getir/order/v1/order.proto \
  -d '{"order_id":"<1. adımdan>","user_id":"usr_1","payment_method":"PAYMENT_METHOD_CARD",
       "card_token":"tok_test_4242","idempotency_key":"4f1c3a2b-9d8e"}' \
  localhost:50053 getir.order.v1.OrderService/CreateOrder

# 2b) 3DS istendiyse onayla → PAID (mock kod 123456; yanlış kod THREEDS_FAILED + kalan hak)
grpcurl -plaintext -import-path packages/proto/proto -proto getir/order/v1/order.proto \
  -d '{"order_id":"<1. adımdan>","user_id":"usr_1","challenge_id":"<2. adımdan>",
       "code":"123456","idempotency_key":"7e6d5c4b-3a2f"}' \
  localhost:50053 getir.order.v1.OrderService/ConfirmPayment

# 3) Geçmiş → en yeni sipariş başta; Mongo modunda Compass'ta getir.orders altında da görünür
grpcurl -plaintext -import-path packages/proto/proto -proto getir/order/v1/order.proto \
  -d '{"user_id":"usr_1","page":{"page_size":10}}' \
  localhost:50053 getir.order.v1.OrderService/ListMyOrders

# 4) İptal → CANCELLED: yalnızca DRAFT / RESERVED / AWAITING_PAYMENT (B29); 2. adımda PAID
#    olan sipariş ORDER_STATE_INVALID alır, bu yüzden yeni bir taslakla dene.
#    Anahtarsız istek INVALID_ARGUMENT.
grpcurl -plaintext -import-path packages/proto/proto -proto getir/order/v1/order.proto \
  -d '{"order_id":"<yeni taslak>","user_id":"usr_1","reason":"CHANGED_MIND","idempotency_key":"9a8b7c6d-5e4f"}' \
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
