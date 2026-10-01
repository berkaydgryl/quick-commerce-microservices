# @getir/order-service

Sipariş gerçeğinin ve checkout saga'sının **tek sahibi** (ADR-05): `orders` ve `outbox`
koleksiyonları. Sipariş durumunu **yazabilen tek yer** burasıdır; başka servis durumu
değiştiremez, yalnızca bu servisin RPC'lerini çağırır.

Bu serviste **olmayanlar**, bilinçli: stok sayacı `inventory-service`'in, kart çekimi
`payment-service`'in, skor hesabı `risk-service`'in işidir. Risk **bandının aksiyonu** ise
(kapıda ödeme kapalı, rezervasyon süresi, reddet) burada verilir — risk servisi yalnızca
skor önerir.

## Bugünkü durum (T7.3 — outbox ile olay yayını)

| RPC                | Durum                                                                                                                          |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| `CreateDraftOrder` | ✅ Fiyatı catalog'dan okur, sunucuda hesaplar, `expected_total` ile karşılaştırır; tutarı taslakta dondurur (T7.2)             |
| `CreateOrder`      | ✅ Saga (T7.1): risk-svc → bant kararı → payment-svc çekimi; `PAID`, `PAYMENT_FAILED`, 3DS beklemesi ya da `REVIEW`/`REJECTED` |
| `ConfirmPayment`   | ✅ 3DS kodu (T7.1): doğruysa `PAID`; hak biter / süre dolarsa `PAYMENT_FAILED`                                                 |
| `GetOrder`         | ✅ Tek sipariş, zaman çizelgesi dahil; başkasının siparişi `NOT_FOUND`                                                         |
| `ListMyOrders`     | ✅ Yeniden eskiye, imleçle sayfalı; sipariş yoksa boş liste                                                                    |
| `CancelOrder`      | ✅ Kullanıcı iptali: yalnızca `DRAFT`, `RESERVED`, `AWAITING_PAYMENT` (B29); Idempotency-Key zorunlu (D4)                      |

## Veri kaynağı: Mongo ya da MOCK

| `MOCK` | Kaynak                                                      | Gerekenler                                                                                               |
| ------ | ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `true` | Bellek (`infrastructure/memory`); olaylar bellekte          | Yok; yeniden başlayınca unutur, **olay yayını kapalı**; persona geçmişi açılışta yüklenir (T8.1)         |
| değil  | `orders` + `outbox` koleksiyonları (`infrastructure/mongo`) | `ORDER_MONGO_URI` (kendi veritabanı `getir_order`, D14) ve `REDIS_URL` zorunlu (yayın `stream:events`'e) |

İki uygulama **aynı sözleşme testinden** geçer (`test/support/order-store-contract.ts`): birim
testinde bellek, entegrasyon testinde gerçek Mongo. Depoyu seçip açan tek yer
`infrastructure/order-store.ts`'tir; indeksler açılışta kurulur.

**Üç port, her use-case yalnızca ihtiyacını alır:** `OrderRepository` (`insert`, `update`,
`findById`) taslak açan, ilerleten ve iptal eden use-case'lerin; `OrderHistoryReader`
(`listByUser`, `hasPaidOrder`, `riskHistory`) okuyanların; `OrderOutbox` (`append`, `pending`,
`markPublished`) olay yayıncısının ve saga'nın telafi komutunun (T7.3).

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

**Kalemler ve tutarlar:** proto `Order`'daki fiyatlı kalemler (`items`) ve tutarlar (`subtotal`,
`delivery_fee`, `discount`, `total`) taslakta dondurulan değerlerdir (T7.2); `GetOrder` onları
olduğu gibi döner. **Bilerek boş bırakılanlar:** `reservation_expires_at` (stok kilidi T11.2'de)
ve `dark_store_id` (okunmaz, ADR-15); `market_id` zorunlu ve `mkt_` biçimlidir.

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
3. **`sku` isteğe bağlı (T7.5):** REST sepeti sku taşımaz; kaleme catalog teklifinin sku'su
   yazılır. Verildiyse (eski istemci, grpcurl) teklifle eşleşmeli, yoksa `skuMismatchProductIds`.
   Kupon kodu sınırı REST ile ortaktır: contracts `COUPON_CODE_MAX_LENGTH` (32).
4. **Kontrol sırası ve hatalar** (hiçbirinde taslak açılmaz):

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
taslaktan siparişe geçen süre (checkout-dwell; T11.2'de başlangıç `reservedAt` olur).

**Gateway sinyalleri (T7.5):** IP, IP şehri, cihaz, cihazdaki hesap sayısı, önceki IP, oturum
konumu ve hesap yaşını gateway bilir; `CreateOrderRequest.signals` (`CheckoutSignals`) ile gelir
ve order onları **yorumlamadan** `RiskContext`'teki aynı adlı alanlara taşır
(`infrastructure/risk/grpc-risk-assessment.ts`). Bugün gateway yalnızca bağlantının IP'sini
doldurur; diğerleri T8.1'de oturumdan gelir. Boş metin, 0 ve gönderilmeyen mesaj "yok" demektir:
eksik sinyal kuralı tetiklemez. Metinler en fazla 128 karakter (`MAX_SIGNAL_TEXT_LENGTH`).

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
`PAID`) iade yapılmaz. Doğrudan iade de başarısız olursa `payment.refund_requested` komutu
outbox'a yazılır (WARN; payment-svc dinleyip iade eder, T7.4); komut da yazılamazsa son çare
ERROR günlüğü. İstemci her durumda `CONFLICT` alır. Eş zamanlı yazımda kaybedenin gerçekten
`CONFLICT` alması mongo-kit'in transaction yeniden denemesine dayanır (aşağıda, T7.3).

**3DS onayı (`ConfirmPayment`):** kod payment-svc'ye aynen iletilir. Yanlış kodda payment-svc'nin
`THREEDS_FAILED`'ı (kalan hak, sebep) istemciye aynen döner, sipariş bekler. Hak biterse ya da
süre dolarsa sipariş önce `PAYMENT_FAILED` yazılır, hata yine aynı. Sipariş zaten `PAID` ise
(onay cevabı kaybolmuş) payment-svc'ye gidilmez, aynı sonuç döner.

Adresler `RISK_GRPC_ADDR` (varsayılan `localhost:50055`) ve `PAYMENT_GRPC_ADDR`
(`localhost:50054`); süre sınırları 1 sn ve 3 sn — toplamları gateway'in 5 sn'sinin altında.

## Outbox ile olay yayını (T7.3, ADR-04)

"Önce yaz, sonra yayınla" iki adımı arasında çökülürse sipariş vardır ama kimse duymamıştır.
Bu yüzden sipariş ve olayları **tek Mongo transaction'ında** yazılır; ayrı bir işçi
yayınlanmamış olayları sonra `stream:events`'e basar.

| Olay                       | Ne zaman                                     | Payload                                                            |
| -------------------------- | -------------------------------------------- | ------------------------------------------------------------------ |
| `order.created`            | Taslak açılınca (B8: kimlik burada doğar)    | `orderId, userId, marketId, status, totalMinor, currency, version` |
| `order.status_changed`     | Her geçişte, **geçiş başına bir olay**       | `orderId, userId, marketId, from, to, note?, version`              |
| `payment.refund_requested` | Telafi: doğrudan iade başarısız (T7.1 borcu) | `orderId, reason, idempotencyKey`                                  |

- **Olay unutulamaz:** `OrderRepository.insert/update` olayları **zorunlu** parametre olarak
  alır (`domain/order-events.ts` türetir). Sipariş yazıldıktan sonra olay yazımı patlarsa
  transaction geri alınır, sipariş de eski halinde kalır (sözleşme testi
  `test/support/order-outbox-contract.ts`, gerçek Mongo'da `test/integration/outbox.spec.ts`).
- **Eş zamanlı yazım (inceleme bulgusu):** başka bir transaction aynı siparişi tutarken yazan
  kaybeden Mongo'dan `WriteConflict` alır. mongo-kit bu "geçici" hatayı sürücüye geri verir,
  sürücü transaction'ı yeniden dener ve kaybeden güncel sürümü görüp `CONFLICT` üretir. Bu
  olmadan `INTERNAL` dönüyor ve saga'nın iade telafisi hiç çalışmıyordu.
- **Zarf (ADR-07):** yayında `@getir/event-bus` zarfına çevrilir: `eventId` (`evt_…`),
  `topic`, `partitionKey` = `orderId`, `occurredAt`, `payload`. `version` realtime'ın soket
  `seq`'i olarak kullanılabilir.
- **Yayıncı** (`interfaces/workers/outbox-publisher.ts` → `application/relay-outbox.ts`): 500 ms'de
  bir tur, turda en fazla 100 olay, yayın sırası `occurredAt`, eşitlikte `version`. İlk hatada tur
  durur (sonraki olay öncekini geçmesin); yalnızca yayınlananlar işaretlenir. Dolu parti çıkarsa
  beklemeden devam eder. Zincirli `setTimeout`: turlar üst üste binmez; kapanışta süren tur
  beklenir, sonra Redis, en son Mongo kapanır.
- **Metrikler (T10.5, #12; `interfaces/workers/outbox-metrics.ts`):** `outbox_events_published_total`
  (hatta yayınlanan), `outbox_relay_errors_total` (yarıda kalan ya da hiç yapılamayan tur) ve
  `outbox_lag_seconds` (turun gördüğü en eski yayınlanmamış olayın yaşı). Sağlıklı yayında gecikme tur
  aralığının (0,5 sn) altında kalır; büyümesi hattın takıldığını gösterir. Uç `localhost:51053/metrics`.
- **En az bir kez teslim:** yayınla–işaretle arasında çökülürse olay tekrar gider; tüketici
  tekrar-güvenli yazılır (`eventId` ya da iş anahtarıyla; payment iadeyi kaydın durumundan tanır).
- **Telafi komutu:** çekim başarılı ama sipariş `PAID` yazılamadıysa önce doğrudan iade denenir;
  o da olmazsa `payment.refund_requested` outbox'a yazılır; payment-svc `payment` tüketici
  grubuyla dinleyip iade eder (T7.4, gövde şeması `@getir/contracts` `events.ts`). Komut tekrar
  gelirse ikinci iade yapılmaz; işlenemezse `stream:events:dead`'e düşer (payment README). Komut
  da yazılamazsa son çare ERROR günlüğü.
- **İndeks:** `outbox` üzerinde `{ publishedAt, occurredAt, version, _id }`; yayıncının
  `{ publishedAt: null }` + sıralı okuması indeksten, bellekte sıralamasız (explain testli).
  Roadmap veri modelindeki "sparse" bilerek yok: `{ publishedAt: null }` sorgusu alanı hiç
  olmayan belgeleri de eşler, planlayıcı sparse indeksi bu sorgu için kullanmaz.
- **Bilinen sınır:** tek order örneği varsayılır. İki örnek aynı olayı aynı anda yayınlayabilir;
  en az bir kez teslim ve `eventId` tekilleştirmesi bunu zararsız kılar (kiralama/lider seçimi
  gerekirse T10.3'ün `lock:reconcile` kalıbı). Yayınlanmış satırların budanması ADR-04'teki
  kabul edilen borçtur.

## Katmanlar

```text
src/
├── domain/            # saf iş kuralı — mongodb/grpc/proto importu YOK
│   ├── order.ts                 # Order, createDraftOrder, transitionOrder (timeline + version)
│   ├── order-item.ts            # dondurulmuş kalem (OrderItem) ve tutar (OrderPricing)
│   ├── price-draft.ts           # saf fiyat kuralı: priceDraft, assertExpectedTotal (T7.2)
│   ├── order-state-machine.ts   # geçiş tablosu, USER_CANCELLABLE
│   ├── order-repository.ts      # port: insert / update(sürümlü, olaylarla) / findById + hataları
│   ├── order-events.ts          # olay türetme: created, status_changed, refund_requested (T7.3)
│   ├── order-outbox.ts          # port: append / pending / markPublished (T7.3)
│   ├── order-history-reader.ts  # port: listByUser, hasPaidOrder (ILK10), riskHistory (T7.1)
│   ├── checkout-risk.ts         # saga risk adımı: bant → karar/politika, risk bağlamı (T7.1)
│   ├── checkout-payment.ts      # saga ödeme adımı: ödeme sonucu → sipariş, anahtarlar (T7.1)
│   └── order-history-cursor.ts  # geçmiş sırası ve imleç
├── application/       # bir dosya = bir use-case
│   ├── create-draft-order.ts, create-order.ts, confirm-payment.ts, cancel-order.ts
│   ├── get-order.ts, list-my-orders.ts
│   ├── risk-step.ts, payment-step.ts  # saga adımları (T7.1), use-case'ler paylaşır
│   ├── relay-outbox.ts          # tek yayın turu: bekleyenler → hat → işaret (T7.3)
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
│   ├── fixtures/persona-orders.ts  # demo personalarının sipariş geçmişi (T8.1)
│   └── mongo/                   # belge şekli, çeviriciler, sorgular (orders, outbox), portlar
├── interfaces/grpc/   # ince handler'lar: doğrula → çağır → çevir
│   ├── schemas.ts     # Zod istek şemaları (sayfa boyutu kırpma, jeton çözme)
│   ├── page-token.ts  # imleç ↔ opak sayfa jetonu
│   ├── mappers.ts     # domain → proto (durum, Order)
│   └── order-handlers.ts
├── interfaces/workers/outbox-publisher.ts  # zamanlayıcı: turu aralıkla çalıştırır, kapanışta bekler
├── interfaces/workers/outbox-metrics.ts    # yayın, hata ve gecikme metrikleri (T10.5)
├── config/            # env.ts (process.env yalnızca burada) + constants.ts
├── bootstrap.ts
├── main.ts
└── healthcheck.ts
```

Zaman `Clock` soyutlaması üzerinden okunur — `Date.now()` iş mantığında çağrılmaz, böylece
testte saat sabitlenebilir.

## Demo personalarının sipariş geçmişi (T8.1)

risk-svc'nin `order-history` ve `basket-anomaly` kuralları bu servisin siparişlerinden beslenir
(`riskHistory`: teslim ve iptal sayısı, ortalama sepet). Personaların hesapları gateway'dedir;
geçmişleri burada (`infrastructure/fixtures/persona-orders.ts`), aynı kullanıcı kimlikleriyle:

| Persona | Teslim | İptal | Ortalama sepet |
| ------- | ------ | ----- | -------------- |
| Ayşe    | 5      | 0     | 200 TL         |
| Zeynep  | 0      | 0     | —              |
| Can     | 1      | 3     | 120 TL         |
| Ali     | 3      | 1     | 180 TL         |
| Komşu   | 12     | 1     | 280 TL         |

Siparişler hazır "Ev" adresine, geçmiş tarihlidir; kimlikleri persona ve sıradan türetilir
(tekrar yazımda kopya olmaz). Olay YAZILMAZ: geçmiş sipariş bugün olmuş gibi yayınlanmaz.

- `MOCK=true`: servis açılırken belleğe yüklenir (production dışında).
- Mongo: `pnpm --filter @getir/order-service seed:personas` personaların eski siparişlerini
  silip tek transaction'da yeniden yazar; `NODE_ENV=production` iken reddeder. Kökteki
  `pnpm seed:personas` bunu gateway'in hesap seed'iyle birlikte çalıştırır.

## Çalıştırma ve doğrulama

```bash
pnpm --filter @getir/order-service build
MOCK=true pnpm --filter @getir/order-service start    # 50053, Mongo'suz (bellek)

pnpm infra:up                                         # ya da Mongo + Redis ile:
MOCK=false pnpm --filter @getir/order-service start   # adresler kok .env'de (ORDER_MONGO_URI, REDIS_URL)

# Yayınlanan olaylar (T7.3): taslak aç / sipariş ver, sonra
docker exec getir-redis redis-cli XRANGE stream:events - +
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
node scripts/check-node-image.mjs getir/order-service   # imaj denetimi (D12), CI'da da kosar
```

Çok aşamalı imaj, `node` kullanıcısı, `grpc.health.v1` ile `HEALTHCHECK`. Ayrıntılı gerekçe
catalog-service README'sinde; iki Dockerfile bilinçli olarak birbirinin eşidir.
