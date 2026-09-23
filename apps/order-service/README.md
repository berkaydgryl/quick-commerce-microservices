# @getir/order-service

Sipariş gerçeğinin ve checkout saga'sının **tek sahibi** (ADR-05): `orders` ve `outbox`
koleksiyonları. Sipariş durumunu **yazabilen tek yer** burasıdır; başka servis durumu
değiştiremez, yalnızca bu servisin RPC'lerini çağırır.

Bu serviste **olmayanlar**, bilinçli: stok sayacı `inventory-service`'in, kart çekimi
`payment-service`'in, skor hesabı `risk-service`'in işidir. Risk **bandının aksiyonu** ise
(kapıda ödeme kapalı, rezervasyon süresi, reddet) burada verilir — risk servisi yalnızca
skor önerir.

## Bugünkü durum (T4.4 — durum makinesi)

| RPC                | Durum                                                                       |
| ------------------ | --------------------------------------------------------------------------- |
| `CreateDraftOrder` | ✅ Kimlik üretir, `DRAFT` açar; zaman çizelgesi `DRAFT` ile başlar          |
| `CreateOrder`      | ✅ Tablodan adım adım: `DRAFT → RISK_CHECK → RESERVED → AWAITING_PAYMENT`   |
| `CancelOrder`      | ✅ Kullanıcı iptali: yalnızca `DRAFT`, `RESERVED`, `AWAITING_PAYMENT` (B29) |
| `GetOrder`         | ⏳ `UNIMPLEMENTED` — T4.5                                                   |
| `ListMyOrders`     | ⏳ `UNIMPLEMENTED` — T4.5                                                   |

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

Siparişler hâlâ **bellekte** tutulur; kalıcılık T4.5 (`orders` repository). Tutar hesabı
`@getir/pricing` ile T7.2'de bağlanır.

Yazılmamış RPC'ler boş bırakılmadı, açıkça `UNIMPLEMENTED` dönüyor — gerekçesi
[catalog-service README'sinde](../catalog-service/README.md) anlatılan ile aynı.

## Neden `CreateDraftOrder` de bu görevde

Görev tanımı `CreateOrder` diyor, ama `CreateOrderRequest` bir `order_id` bekler: kimliği
üreten uç `CreateDraftOrder`'dır (B8 — "rezervasyon, henüz olmayan bir siparişin kimliğiyle
açılamaz"). "grpcurl ile orderId döner" ölçütünü karşılayan uç budur; ikisi birlikte
olmadan zincir denenemezdi.

## İki karar

**Başkasının siparişinde `NOT_FOUND`, `PERMISSION_DENIED` değil.** Sözleşmede yazılı:
"bu kimlikte bir sipariş var" bilgisi bile sızdırılmamalıdır. Yetki hatası dönmek, sipariş
kimliklerini deneyerek varlık taraması yapmayı mümkün kılardı.

**Idempotency anahtarı bugünden zorunlu (ADR-08).** Tekrar koruması (`idem:{key}`) henüz
yok; yalnızca anahtarın varlığı doğrulanıyor. Erken zorunlu tutmanın sebebi: istemciler
göndermeye bugün alışsın, koruma açıldığında sözleşme değişmesin.

## Katmanlar

```text
src/
├── domain/            # saf iş kuralı — mongodb/grpc/proto importu YOK
│   ├── order.ts             # Order, createDraftOrder, geçiş koruması, withStatus
│   └── order-repository.ts  # port (arayüz)
├── application/       # bir dosya = bir use-case
│   ├── create-draft-order.ts
│   └── create-order.ts
├── infrastructure/
│   └── in-memory-order-repository.ts
├── interfaces/grpc/   # ince handler'lar: doğrula → çağır → çevir
│   ├── schemas.ts     # Zod istek şemaları
│   ├── mappers.ts     # domain durumu → proto enum
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
pnpm --filter @getir/order-service start      # 50053 portunda dinler
```

```bash
# 1) Taslak aç → orderId
grpcurl -plaintext -import-path packages/proto/proto -proto getir/order/v1/order.proto \
  -d '{"user_id":"usr_1","dark_store_id":"ds_kadikoy",
       "lines":[{"product_id":"prd_01","sku":"SUT-1L","quantity":2}],
       "delivery_location":{"lat":40.99,"lng":29.02},
       "delivery_address":"Kadıköy","idempotency_key":"4f1c3a2b-9d8e"}' \
  localhost:50053 getir.order.v1.OrderService/CreateDraftOrder

# 2) Siparişe çevir → AWAITING_PAYMENT
grpcurl -plaintext -import-path packages/proto/proto -proto getir/order/v1/order.proto \
  -d '{"order_id":"<1. adımdan>","user_id":"usr_1","idempotency_key":"4f1c3a2b-9d8e"}' \
  localhost:50053 getir.order.v1.OrderService/CreateOrder
```

Aynı akışın otomatik karşılığı `test/unit/order-grpc.spec.ts`.

## Docker

```bash
docker build -f apps/order-service/Dockerfile -t getir/order-service .
docker run --rm -p 50053:50053 getir/order-service
```

Çok aşamalı imaj, `node` kullanıcısı, `grpc.health.v1` ile `HEALTHCHECK`. Ayrıntılı gerekçe
catalog-service README'sinde; iki Dockerfile bilinçli olarak birbirinin eşidir.
