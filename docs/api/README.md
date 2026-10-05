# API dokümantasyonu

Bu klasör gateway'in dışarıya açtığı **iki sözleşmeyi** tutar:

| Dosya                                  | Kapsam                                                     |
| -------------------------------------- | ---------------------------------------------------------- |
| [`openapi.yaml`](openapi.yaml)         | REST yüzeyi (OpenAPI 3.1) — `http://localhost:8080`        |
| [`socket-events.md`](socket-events.md) | Socket.io olay ve oda sözleşmesi — `http://localhost:3001` |

gRPC tarafı buraya girmez; servisler arası sözleşme `packages/proto` altındaki
`.proto` dosyalarıdır ve `buf` ile doğrulanır (CI'daki `contract` işi).

## Tek doğruluk kaynağı: Zod şemaları

Sözleşmenin kaynağı `packages/contracts` içindeki Zod şemalarıdır. Zincir şöyledir:

```
packages/contracts/*.ts   (Zod şeması — tek doğruluk kaynağı)
        |
        |  zod-to-openapi (T19.1)
        v
docs/api/openapi.yaml     (üretilen REST sözleşmesi)
        |
        |  elle dışa aktarım (T19.1)
        v
docs/api/postman_collection.json
```

- **Bugünkü durum (Gün 1):** `openapi.yaml` el ile yazılmış bir **iskelettir**.
  Uç listesi, zarf biçimi, hata kodları ve idempotency kuralları burada
  sabitlenir; servisler bu iskelete göre yazılır.
- **T19.1'de:** `pnpm docs:api` betiği Zod şemalarından `openapi.yaml`'ı üretir
  ve el yazımı sürümün yerini alır. O noktadan sonra bu dosya **elle
  düzenlenmez**; değişiklik Zod şemasında yapılır ve dosya yeniden üretilir.
- **Postman koleksiyonu** da T19.1'de üretilen `openapi.yaml`'dan dışa aktarılır;
  demo senaryosunun (`pnpm demo`) adımlarıyla aynı sırayı taşır.

## Hata kodu sözlüğünü senkron tutma

`openapi.yaml` içindeki `components.schemas.ErrorCode` listesi, `packages/core`
içindeki `ErrorCode` sözlüğünün **birebir kopyasıdır**. Tek doğruluk kaynağı
core'dur: ayrışma varsa core kazanır ve YAML güncellenir. Yeni bir hata kodu
eklerken sıra şudur:

1. `packages/core` içindeki sözlüğe kodu ekle.
2. `openapi.yaml` içindeki `ErrorCode` enum'una aynı adla ekle.
3. Kodu döndüren ucun ilgili 4xx cevabına bir `examples` girdisi yaz —
   bu dosyadaki kural: **her uç, döndürdüğü her hata kodunu örnekle gösterir.**

## HTTP durumu ↔ hata kodu eşlemesi

Durum kodu taşıma katmanını, `error.code` iş anlamını anlatır. İstemci dallanmayı
**her zaman `error.code` üzerinden** yapar; durum kodu yalnızca kaba sınıflamadır.

| HTTP | Hata kodlari                                                                                                                                      |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| 202  | `RISK_REVIEW`                                                                                                                                     |
| 400  | `VALIDATION_FAILED`                                                                                                                               |
| 401  | `UNAUTHORIZED`, `INVALID_CREDENTIALS`                                                                                                             |
| 402  | `PAYMENT_DECLINED`, `THREEDS_FAILED`, `THREEDS_REQUIRED`                                                                                          |
| 403  | `FORBIDDEN`, `RISK_BLOCKED`                                                                                                                       |
| 404  | `NOT_FOUND`, `NO_STORE`                                                                                                                           |
| 409  | `CONFLICT`, `PHONE_ALREADY_REGISTERED`, `STOCK_INSUFFICIENT`, `RESERVATION_ACTIVE`, `PRICE_CHANGED`, `REQUEST_IN_PROGRESS`, `ORDER_STATE_INVALID` |
| 410  | `RESERVATION_EXPIRED`                                                                                                                             |
| 422  | `COUPON_INVALID`, `MIN_BASKET_NOT_MET`, `PAYMENT_METHOD_NOT_ALLOWED`                                                                              |
| 429  | `RATE_LIMITED`                                                                                                                                    |
| 500  | `INTERNAL`                                                                                                                                        |
| 501  | `NOT_IMPLEMENTED` (sözleşmede olan ama henüz yazılmamış uç, D5)                                                                                   |
| 503  | `SERVICE_UNAVAILABLE`                                                                                                                             |

> Bu tablo elle bakim yapilan bir kopya degildir: kaynagi
> `packages/core/src/error-codes.ts` icindeki `ERROR_CODE_HTTP_STATUS` tablosudur.
> Core'da bir esleme degisirse burasi da guncellenir; ayrisma olursa core kazanir.

## Değişmez sözleşme kuralları

- **Para** her yerde minor unit (kuruş) cinsinden **tam sayıdır**. `Money` şeması
  `{ amountMinor: integer, currency: "TRY" }` biçimindedir; float hiçbir katmanda
  kullanılmaz, 100'e bölme yalnızca gösterim anında istemcide yapılır.
- **Zarf**: her cevap `{ success: true, data }` veya `{ success: false, error }`
  biçimindedir. `error` alanı `code`, `message`, `details` ve `requestId` taşır.
- **Ayrıntı (`details`)** bir JSON nesnesidir ve değerleri servisin gönderdiği
  gibi geçer (T7.5): `PRICE_CHANGED`'de güncel toplam **sayıdır**
  (`totalMinor: 19360`), satışta olmayan ürünler **dizidir**
  (`unavailableProductIds`), doğrulama hataları alan → sebep metnidir ve alan adı
  istemcinin gönderdiği addır (`items.0.quantity`, `address.location.lat`,
  `Idempotency-Key`).
- **Kimlik** (T8.1): `GET /v1/me`, `/v1/me/...` uçları (adres defteri, favoriler,
  e-posta doğrulama, kart kasası) ve sipariş uçları (`/v1/cart/reserve`, `/v1/orders...`)
  `Authorization: Bearer <erişim jetonu>` ister. Jeton kayıt,
  giriş ya da yenilemeyle alınır (HS256 JWT, ömrü JWT_TTL); yoksa ya da
  geçersizse `401 UNAUTHORIZED` + `WWW-Authenticate` döner. Yenileme jetonu
  opaktır, her kullanımda yenisiyle değişir ve sunucuda yalnızca özetiyle
  saklanır. Gövdede taşınmaz: gateway onu `getir_refresh` çerezine yazar
  (HttpOnly, `SameSite=Strict`, `Path=/v1/auth`); `/v1/auth/refresh` ve
  `/v1/auth/logout` gövdesizdir. İstemci erişim jetonunu bellekte tutar, sayfa
  yenilenince `/v1/auth/refresh` ile yeniden alır. Yanlış şifre ile kayıtsız numara aynı cevabı alır
  (`INVALID_CREDENTIALS`). Katalog uçları herkese açıktır. T7.5'teki
  `X-User-Id` geliştirme başlığı kaldırıldı.
- **Geçmiş siparişler** (T11.16): `GET /v1/orders` kullanıcının siparişlerini yeniden
  eskiye, imleçle sayfalı özet olarak döner (`items` + `page`; `page.totalSize` 0: süzme
  yüzünden sayılmaz). Sepet taslakları (`DRAFT`, hiç ilerlemeden süresi dolan `EXPIRED`)
  listede yoktur. Market adı katalogdan; gelmezse alan yoktur. Ücreti alınmış iptalde
  `refunded: true`. Liste ve `GET /v1/orders/{id}` `Cache-Control: no-store` ile gelir.
- **Oda jetonu** (T12.2): `GET /v1/orders/{id}/token` siparişin sahibine,
  `order:{orderId}` odasına katılmak için 60 sn'lik jeton verir; başkasının
  siparişi `404`. Jeton erişim jetonundan ayrı bir sırla imzalanır ve yalnızca
  realtime'ın `room.join`'inde geçer; erişim jetonu realtime'da oda jetonu yerine
  geçmez. Ayrıntı: [`socket-events.md`](socket-events.md) "Oda jetonu".
- **Risk sinyalleri istemciden alınmaz** (B9): gateway bağlantının IP'sini
  order'a iletir; istemcinin yazabildiği `X-Forwarded-For` okunmaz. Cihaz, önceki
  giriş IP'si ve oturum konumu oturumdan; hesap yaşı ve hesabın açıldığı cihazdan
  açılmış hesap sayısı kullanıcı kaydından gelir (T8.1). Cihaz kimliğini gateway kayıt
  ve girişte `getir_device` çereziyle (HttpOnly) verir. Oturumu kapatılmış jetonla
  sipariş `401` alır. Numara değişince (T11.14 PR 3) diğer cihazların yenilemesi
  hemen durur; ellerindeki erişim jetonu en geç `JWT_TTL` (1 sa) içinde biter
  (sipariş hemen `401`). Kalıcı çözüm bekleyen iş #24 (iptal edilen oturum listesi).
- **Idempotency-Key**, kalıcı durum değiştiren uçlarda zorunludur:
  `POST /v1/auth/register`, `PATCH /v1/me`, `POST /v1/me/addresses`, `PUT` ve
  `DELETE /v1/me/addresses/{addressId}` (T11.15), `PUT` ve
  `DELETE /v1/me/favorites/{marketId}`, `POST /v1/me/cards` ve
  `DELETE /v1/me/cards/{cardId}` (T11.17), `POST /v1/me/email/code`,
  `POST /v1/me/email/verify` (T11.14), `POST /v1/me/phone/code`,
  `POST /v1/me/phone/verify` (T11.14 PR 3; yalnızca geliştirmede), `POST /v1/cart/reserve`,
  `DELETE /v1/cart/reserve/{orderId}`, `POST /v1/orders`,
  `POST /v1/orders/{id}/3ds`. `POST /v1/auth/login`, `/v1/auth/refresh` ve
  `/v1/auth/logout` istemez: giriş ve yenileme kalıcı bir kaynak yaratmaz,
  çıkışın tekrarı zararsızdır.
  Tekrar koruması gateway'dedir (T8.2, ADR-08 eki; `DELETE /v1/cart/reserve/{orderId}`
  T11.4'te geldi): anahtar 8-128 karakter, yalnızca harf, rakam, `-` ve
  `_` (biçimsizse 400) ve kullanıcı başınadır. Aynı anahtarla aynı istek ucu
  ikinci kez çalıştırmaz, ilk cevap `Idempotent-Replayed: true` başlığıyla aynen
  döner; ilk istek sürüyorsa `409 REQUEST_IN_PROGRESS`, anahtar farklı gövdeyle
  gelirse `409 CONFLICT`. 400, 401, 429 ve 5xx saklanmaz (aynı anahtarla yeniden
  denenir). Kayıt başarılı sipariş/3DS için 2 saat, diğerlerinde 24 saat
  (`IDEMPOTENCY_TTL_SECONDS`) tutulur. Kayıt ucu istisnadır: cevabı jeton
  taşıdığı için tekrar edilmez, biten kaydın tekrarı `409 PHONE_ALREADY_REGISTERED`
  alır. Redis erişilemezse bu uçlar `503` döner (korumasız sipariş alınmaz).
- **Hız sınırı** (T8.2, roadmap P2): uç başına kayan pencere (60 sn), Redis'te; gateway örnekleri
  aynı sayacı paylaşır. Kimliksiz uçlarda IP, kimlik isteyen uçlarda kullanıcı sayılır. Pencere
  başına kayıt ve giriş 10, rezervasyon/sipariş/3DS 20, diğerleri (yenileme ve çıkış dahil) 120 (`RATE_LIMIT_*`). Aşılınca
  `429 RATE_LIMITED` + `Retry-After` (saniye) + `details.retryAfterSeconds`; yalnızca kabul edilen
  istek sayılır. Sayaca ulaşılamazsa istek geçer (tekrar koruması ise 503 der). `/healthz` sınırsız.
- **Kart verisi** (T11.17): tam kart numarası ve CVV yalnızca `POST /v1/me/cards`
  gövdesinde ve bir kez geçer; kasa (payment) doğrular, maskeleyip saklar. Hiçbir
  cevapta, günlükte, izde ve hata ayrıntısında yoktur: doğrulama cümleleri girilen
  değeri yankılamaz (`@getir/contracts` `CARD_FIELD_MESSAGES`). Cevaplar maskelidir:
  `id`, `brand`, `first4`, `last4`, `expiryMonth`, `expiryYear`, `holderName`,
  `nickname?`, `expired`, `createdAt`. Yeni hata kodu yok: `VALIDATION_FAILED`
  (alan → cümle; dolu kasa `cards`), `PAYMENT_DECLINED` (doğrulama reddi,
  `details.reason = verification_declined`), `CONFLICT` (aynı kart, `details.cardId`),
  `NOT_FOUND` (silme). Kurallar `@getir/contracts` `cards.ts`'te, kasa aynı
  fonksiyonlarla denetler: TROY yalnızca 9792 (65 aralığı Discover ile çakışır);
  son kullanma ayı Türkiye saatiyle; ad ve kart adı NFC'ye çevrilir, adda en az bir
  harf; kart adında biçim/kontrol karakteri ve 8+ yan yana rakam yok, boş kart adı
  "yok" demektir. Aynı kart kullanıcının kasasında ilk 4 + son 4 + son kullanma ile
  tanınır; bunu paylaşan iki farklı kart nadirdir, numaranın HMAC'i tutulmaz (D1).
- **İzleme**: her cevap `X-Request-Id` başlığı taşır; hata gövdesindeki
  `error.requestId` ile aynı değerdir. Biçim `req_` + 32 küçük onaltılık karakter
  (Node servisleriyle aynı). İstemci bu biçimde kendi kimliğini gönderirse korunur;
  biçim dışı değer yok sayılır ve gateway yenisini üretir (D8).

## Dosyayı düzenlerken

1. `openapi.yaml` tek satırlık bir sözdizimi hatasıyla tüm dokümanı bozabilir;
   düzenledikten sonra bir OpenAPI doğrulayıcıdan geçir.
2. Uç ekliyorsan: `paths` altındaki girdiye `operationId`, `tags`, en az bir
   başarılı cevap ve döndürdüğü **her** hata kodu için `examples` gir.
3. Yeni ortak tip gerekiyorsa `components.schemas` altına koy; uç içine gömme —
   aynı yapı ikinci kez gerektiğinde kopyalanmış tip çıkar.
