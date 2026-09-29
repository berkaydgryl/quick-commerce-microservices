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
- **Kimlik** (T8.1): `GET /v1/me` ve sipariş uçları (`/v1/cart/reserve`,
  `/v1/orders...`) `Authorization: Bearer <erişim jetonu>` ister. Jeton kayıt,
  giriş ya da yenilemeyle alınır (HS256 JWT, ömrü JWT_TTL); yoksa ya da
  geçersizse `401 UNAUTHORIZED` + `WWW-Authenticate` döner. Yenileme jetonu
  opaktır, her kullanımda yenisiyle değişir ve sunucuda yalnızca özetiyle
  saklanır. Yanlış şifre ile kayıtsız numara aynı cevabı alır
  (`INVALID_CREDENTIALS`). Katalog uçları herkese açıktır. T7.5'teki
  `X-User-Id` geliştirme başlığı kaldırıldı.
- **Risk sinyalleri istemciden alınmaz** (B9): gateway bağlantının IP'sini
  order'a iletir; istemcinin yazabildiği `X-Forwarded-For` okunmaz. Cihaz, önceki
  giriş IP'si ve oturum konumu oturumdan; hesap yaşı ve hesabın açıldığı cihazdan
  açılmış hesap sayısı kullanıcı kaydından gelir (T8.1). Cihaz kimliğini gateway kayıt
  ve girişte `getir_device` çereziyle (HttpOnly) verir. Oturumu kapatılmış jetonla
  sipariş `401` alır.
- **Idempotency-Key**, kalıcı durum değiştiren uçlarda zorunludur:
  `POST /v1/auth/register`, `POST /v1/cart/reserve`,
  `DELETE /v1/cart/reserve/{orderId}`, `POST /v1/orders`,
  `POST /v1/orders/{id}/3ds`. `POST /v1/auth/login`, `/v1/auth/refresh` ve
  `/v1/auth/logout` istemez: giriş ve yenileme kalıcı bir kaynak yaratmaz,
  çıkışın tekrarı zararsızdır.
  Bugün gateway yalnızca **varlığını** doğrular (yoksa 400), uzunluk kuralı
  (8-128) servistedir; aynı anahtarla gelen ikinci isteğin ilk cevabı alması
  (tekrar koruması) T8.2 ile gelir.
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
