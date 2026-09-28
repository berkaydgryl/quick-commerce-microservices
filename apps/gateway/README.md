# apps/gateway

Tarayıcının konuştuğu **tek dış kapı** (Go + Fiber v3). Tarayıcı hiçbir gRPC servisine
doğrudan erişemez; REST isteği burada karşılanır, doğrulanır ve gRPC çağrısına çevrilir.

Pnpm workspace'inin parçası değildir: kendi Go modülüdür (`go.mod`). `pnpm verify` bu klasörü
kapsamaz; kapısı CI'daki **`gateway`** işidir (gofmt, vet, golangci-lint, `go mod tidy -diff`,
`-race` testleri, statik derleme).

## Bugünkü durum (D8 — Go kuralları CI'da; T7.5 — sipariş uçları; pazaryeri uçları T8.4'ten öne alındı)

| Parça                | Durum                                                           |
| -------------------- | --------------------------------------------------------------- |
| Env doğrulaması      | ✅ Açılışta, hatalar toplu raporlanır; geçersizse çıkış kodu 1  |
| gRPC istemci havuzu  | ✅ catalog + order, tembel bağlantı, keepalive                  |
| `GET /healthz`       | ✅ Servisleri paralel sorgular; hepsi ayaktaysa 200, değilse 503 |
| Cevap zarfı          | ✅ `packages/contracts` ile aynı biçim, her cevapta `requestId` |
| Korelasyon kimliği   | ✅ `req_` + 32 hex; gelen kimlik yalnızca bu biçimdeyse korunur (D8) |
| Zarif kapanış        | ✅ SIGINT/SIGTERM → devam eden istekler beklenir                |
| `GET /v1/categories` | ✅ catalog `ListCategories`; bilinmeyen sorgu parametresi 400   |
| `GET /v1/markets?lat&lng` | ✅ Yakındaki marketler; boş bölge = boş liste, hata değil |
| `GET /v1/markets/{id}` | ✅ Market sayfası başlığı; puan onda birden ondalığa (`47` → `4.7`) |
| `GET /v1/markets/{id}/categories` | ✅ Marketin teklifi olan kategoriler |
| `GET /v1/markets/{id}/products` | ✅ `categoryId`, `q`, `pageToken`, `pageSize`; **stok yok** (aşağıda) |
| `POST /v1/cart/reserve` | ✅ order `CreateDraftOrder` (T7.5): taslak, fiyat sunucuda; **stok kilidi yok** (T11.2) |
| `POST /v1/orders`    | ✅ order `CreateOrder` (saga): 201 `PAID` ya da `AWAITING_PAYMENT` + `threeDs` |
| `POST /v1/orders/{id}/3ds` | ✅ order `ConfirmPayment`; yanlış kod 402 + kalan hak |
| `GET /v1/orders/{id}` | ✅ order `GetOrder`; başkasının siparişi 404 |
| Kullanıcı kimliği    | ⚠️ Geçici: `X-User-Id` yalnızca production dışında (JWT T8.1) |
| Idempotency-Key      | ✅ Zorunlu (yoksa 400); tekrar koruması ⏳ T8.2                 |
| gRPC hata çevirisi   | ✅ `x-app-error` trailer'ı, yoksa durum kodu (`apperror`)       |
| Görsel adresleri     | ✅ Göreli yol → mutlak URL (`ASSET_BASE_URL`, `internal/assets`) |
| Stok birleştirmesi (B27) | ⏳ inventory-svc ile (T8.4 / T9.x) |
| JWT, rate limit      | ⏳ T8.1, T8.2                                                   |
| Go kuralları         | ✅ CI'da golangci-lint: `errcheck`, `noctx`, `bodyclose` (D8)    |

## Çalıştırma

Gateway, `packages/proto`'nun **üretilen** Go koduna `replace` ile bağlıdır ve `gen/` depoda
yoktur. İlk derlemeden (ve her `.proto` değişikliğinden) önce Go kodu üretilmelidir:

```bash
pnpm proto:gen                       # TS + Go (Go icin buf + protoc eklentileri gerekir)
cd apps/gateway
ASSET_BASE_URL=http://localhost:5173 go run ./cmd/gateway   # :8080 (ASSET_BASE_URL zorunlu)
curl -s localhost:8080/v1/categories | jq
curl -s localhost:8080/healthz | jq
go test -race ./...
```

Go kuralları (CI'daki golangci-lint ile aynı sürüm; Docker yeter, kurulum gerekmez):

```bash
# depo kokunden
docker run --rm -v "$PWD":/src:ro -w /src/apps/gateway golangci/golangci-lint:v2.14.0 golangci-lint run
```

Docker (build bağlamı **depo köküdür**):

```bash
docker build -f apps/gateway/Dockerfile -t getir/gateway .
docker run --rm -p 8080:8080 \
  -e ASSET_BASE_URL=http://localhost:5173 \
  -e CATALOG_GRPC_ADDR=host.docker.internal:50051 \
  -e ORDER_GRPC_ADDR=host.docker.internal:50053 \
  getir/gateway
```

İmaj `distroless/static:nonroot` üzerindedir (~28 MB). İçinde kabuk olmadığı için Docker
`HEALTHCHECK`'i ikilinin kendi alt komutunu çağırır: `/gateway healthcheck`. Komut 2 sn son
tarihli bir bağlamla `/healthz`'i sorar; sağlıksızsa sebebi stderr'e yazar, Docker onu sağlık
kaydında saklar (`docker inspect`).

## Korelasyon kimliği (`X-Request-ID`)

Her isteğin bir kimliği vardır ve aynı değer dört yerde görünür: cevap başlığı
(`X-Request-ID`), hata zarfı (`error.requestId`), gateway günlüğü (`requestId`) ve servise giden
gRPC metadata'sı (`x-request-id`). Böylece tek istek gateway'den servise kadar günlükte izlenir.

- **Biçim:** `req_` + 32 küçük onaltılık karakter; Node servisleriyle aynı
  (`@getir/core` `id.ts`).
- **Gelen kimlik** yalnızca bu biçimdeyse korunur; biçim dışı değer (serbest metin, çok uzun
  dizi) yok sayılır ve yenisi üretilir (D8). Başlık istemcinin elindedir ve kabul edilen değer
  her servisin günlüğüne yazılır.
- `/healthz` de kimliği servislere taşır. Ara katmana ulaşmadan düşen istekte (64 KB gövde
  sınırı gibi) kimlik hata işleyicide üretilir; hata cevabı yine kimliksiz kalmaz.

## Go kuralları ve lint (D8)

Kuralların kendisi `.cursor/rules/proje-kurallari.mdc` "Go" bölümündedir; CI onları
golangci-lint ile denetler (`.golangci.yml`, yalnızca kuralı olan üç denetleyici):

| Denetleyici | Kural |
| ----------- | ----- |
| `errcheck` (`check-blank`) | Hata yutulmaz; `_ = f()` ve `v, _ := f()` de bulgudur |
| `noctx` | Ağ çağrısı `context` alır (testlerde `t.Context()`) |
| `bodyclose` | HTTP cevap gövdesi kapatılır |

Gerçekten gerekçeli bir istisna satırında yazılır: `//nolint:errcheck // <gerekçe>`;
gerekçesiz `nolint` de bulgudur. Birden fazla paketin testinde gereken yardımcılar
(`BufconnClient`, `AppErrorOf`, `JSON`) `internal/testkit`'tedir; üretim kodu bu paketi
kullanmaz.

`bodyclose`, gövdenin kapatıldığını yalnızca cevabın verildiği fonksiyonun **kendi**
gövdesinde görür. Bu yüzden test yardımcısı `decode` gövdeyi doğrudan kapatır ve yardımcılar
`*http.Response` döndürmez, durum kodu ve zarf döndürür.

## Sipariş uçları (T7.5)

Dört uç tek adaptörden (`internal/order`) order-service'e gider. Hepsi kimlik ister; yazan
üçü `Idempotency-Key` ister. Kurallar (fiyat, risk, 3DS, durum geçişi) order-service'tedir.

- **Kimlik (geçici):** JWT T8.1 ile gelir. O zamana kadar `NODE_ENV` production **değilse**
  kullanıcı `X-User-Id` başlığından okunur (`usr_` + harf/rakam/`_`/`-`); eksik ya da biçimsizse
  401. Production'da başlık **okunmaz**, uçlar 401 döner. Kimliği belirleyen tek yer
  `internal/httpapi/identity.go`; T8.1'de yalnızca o değişir.
- **Katı gövde:** JSON dışı içerik, bozuk JSON, bilinmeyen alan (ör. adres etiketi `title`) ve
  yanlış tip 400 döner; `details` alan adını taşır. Gövde sınırı 64 KB.
- **Gateway'in gördüğü yokluk:** iç içe nesneler (`address.location`, `expectedTotal`)
  gönderilmezse proto'ya da gönderilmez ve servis "zorunlu" der. Gönderilen konumda enlem ya da
  boylam **yoksa** (0 değil, yok) bunu yalnız gateway görür: 400.
- **Risk sinyali (B9):** `POST /v1/orders`'ta bağlantının IP'si `CheckoutSignals.ip_address`
  olarak order'a gider; istemcinin yazabildiği `X-Forwarded-For` okunmaz (güvenilir vekil yok).
- **Alan adları:** servisin proto yolu REST adına çevrilir: `lines.0.quantity` →
  `items.0.quantity`, `deliveryLocation.lat` → `address.location.lat`, `code` → `otp`,
  `idempotencyKey` → `Idempotency-Key`.

```bash
# zsh degiskendeki basliklari bolmez: basliklar her komutta acikca yazilir.
curl -s localhost:8080/v1/cart/reserve -H 'Content-Type: application/json' -H 'X-User-Id: usr_1' \
  -H 'Idempotency-Key: taslak-0001' -d '{
  "marketId":"mkt_migros-jet-moda",
  "items":[{"productId":"prd_bulasik-deterjan","quantity":2},{"productId":"prd_cikolata-80","quantity":1}],
  "address":{"line":"Kadikoy","location":{"lat":40.99,"lng":29.02}},
  "expectedTotal":{"amountMinor":19360,"currency":"TRY"}}' | jq
curl -s localhost:8080/v1/orders -H 'Content-Type: application/json' -H 'X-User-Id: usr_1' \
  -H 'Idempotency-Key: siparis-0001' \
  -d '{"orderId":"<taslak>","payment":{"method":"CARD","cardToken":"tok_test_4242"}}' | jq
curl -s localhost:8080/v1/orders/<taslak>/3ds -H 'Content-Type: application/json' -H 'X-User-Id: usr_1' \
  -H 'Idempotency-Key: onay-0001' -d '{"challengeId":"<tds_...>","otp":"123456"}' | jq   # 3DS istendiyse
curl -s localhost:8080/v1/orders/<taslak> -H 'X-User-Id: usr_1' | jq
```

## Pazaryeri uçları: gateway ne yapar, ne yapmaz

- **Yapar:** bilinmeyen sorgu parametresini reddeder; parametrenin **biçimini** doğrular (`lat` sayı mı,
  `pageSize` tam sayı mı; NaN/sonsuz reddedilir); proto → REST çevirisi (puan ondalık, boş para birimi
  `TRY`, göreli görsel → mutlak URL); servisin doğrulama hatasındaki **proto alan adını istemcinin
  gönderdiği adla** değiştirir (`query` → `q`, `location.lat` → `lat`).
- **Yapmaz:** aralık kuralları (enlem −90..90, arama en az 2 karakter, sayfa boyu kırpma) catalog-service'te
  durur; gateway'de tekrar yazılmaz, iki yerde duran kural bir gün ayrışır.
- **Stok:** ürünlerde `availableQuantity` bugün **yazılmaz**. Sözleşmede alan isteğe bağlıdır ve yokluğu
  "stok bilgisi yok" demektir, "0" değil. inventory-svc bağlanınca gateway iki cevabı birleştirir (B27).

```bash
curl -s "localhost:8080/v1/markets?lat=40.9885&lng=29.0262" | jq '.data.items[].market.name'   # Ev: 3 market
curl -s "localhost:8080/v1/markets?lat=41.1363&lng=29.8539" | jq '.data.items'                 # Yazlik: []
curl -s "localhost:8080/v1/markets/mkt_migros-jet-moda/products?q=s%C3%BCt" | jq '.data.items[].name'
```

## Ortam değişkenleri

| Değişken                     | Varsayılan        | Anlamı                                          |
| ---------------------------- | ----------------- | ----------------------------------------------- |
| `ASSET_BASE_URL`             | **yok — zorunlu** | Görsel adreslerinin kökü (aşağıda)              |
| `GATEWAY_PORT`               | `8080`            | Dinlenen HTTP portu                             |
| `CATALOG_GRPC_ADDR`          | `localhost:50051` | catalog-service adresi (`host:port`)            |
| `ORDER_GRPC_ADDR`            | `localhost:50053` | order-service adresi                            |
| `GATEWAY_REQUEST_TIMEOUT_MS` | `5000`            | Tek bir servis çağrısının üst sınırı            |
| `GRPC_SHUTDOWN_TIMEOUT_MS`   | `10000`           | Kapanışta devam eden istekler için bekleme      |
| `LOG_LEVEL`                  | `info`            | `trace/debug/info/warn/error/fatal` (Node ile ortak) |
| `MOCK`                       | `false`           | `/healthz` cevabında bildirilir (B16)           |
| `NODE_ENV`                   | `development`     | `development/test/production`                   |

## Görsel adresleri (`ASSET_BASE_URL`)

Veri görseli **göreli yol** olarak saklar (`/img/cat/sut.png`), çünkü mutlak adres ortama
bağlıdır. Sözleşme ise mutlak URL ister (`imageUrl: z.string().url()`). Çeviriyi gateway (BFF)
yapar: CDN değişirse yalnızca bu değişken değişir, veri ve istemci değişmez.

| Veride                  | Cevapta (`ASSET_BASE_URL=https://cdn.x/static`) |
| ----------------------- | ----------------------------------------------- |
| `/img/cat/sut.png`      | `https://cdn.x/static/img/cat/sut.png`          |
| `""`                    | alan hiç yazılmaz                               |
| `https://baska.cdn/a.png` | olduğu gibi                                   |
| `javascript:…`, `data:…` | alan hiç yazılmaz (`<img src>`'ye zararlı adres gitmez) |
| `/img/../../x.png`      | `https://cdn.x/static/x.png` (kökün üstüne çıkamaz) |

**Zorunludur, varsayılanı yoktur (fail fast).** Görsellerin nerede barınacağı henüz
kararlaştırılmadı; bir varsayılan bu kararı koda gömer ve canlıda unutulursa istemciye sessizce
`localhost` adresleri gider. Verilmezse gateway açılışta durur:

```text
ortam degiskenleri gecersiz: ASSET_BASE_URL: zorunlu, ornek: http://localhost:5173
```

## `/healthz` sözleşmesi

```json
{ "success": true, "data": { "status": "ok", "mock": false,
  "services": [ { "name": "catalog", "status": "SERVING", "latencyMs": 5 },
                { "name": "order",   "status": "SERVING", "latencyMs": 6 } ] } }
```

Bir servis düşükse **503** ve hata zarfı döner; rapor `error.details` içindedir. Servis
durumu üç değerlidir: `SERVING`, `NOT_SERVING` (servis kendini hasta bildirdi) ve
`UNREACHABLE` (cevap gelmedi). Ulaşılamayan serviste `error` alanı yalnızca gRPC durum kodunu
taşır (`Unavailable`); iç ağ adresi `/healthz` dışarıya açık olduğu için cevaba konmaz.

## Hata modeli (`internal/apperror`)

Her cevabın HTTP kodu ve **mesajı koddan** türetilir; handler ikisini de seçemez. Tablo elle
yazılmaz, `@getir/core/error-codes.ts` (kod → HTTP) ve `@getir/contracts/errors.ts` (kod →
kullanıcı mesajı) kaynaklarından **üretilir**:

```bash
pnpm build && pnpm codes:go          # apps/gateway/internal/apperror/codes_gen.go
pnpm codes:go:check                  # fark varsa exit 1 (pnpm verify ve CI bunu kosar)
```

Üretilen dosya depoya girer ki Go tarafı Node olmadan derlenebilsin.

Bağımlı servis hatası şu sırayla çözülür:

1. `x-app-error` trailer'ı (service-kit'in yazdığı AppError JSON'u) varsa ve kod sözlükteyse → o
   kod ve `details`. Ayrıntı bir JSON **nesnesi** olmalı (dizi ya da sayı düşürülür); değerleri
   OLDUĞU GİBİ geçer (T7.5): `PRICE_CHANGED`'in güncel toplamı sayı, satışta olmayan ürünler dizi
   olarak istemciye ulaşır. (Önceki sürüm yalnızca metin → metin kabul ediyordu ve bu sayılar
   yolda kayboluyordu.)
2. Yoksa gRPC durum kodu → hata kodu (`service-kit` `errorCodeForStatus` ile aynı eşleme):
   `Unavailable` / `DeadlineExceeded` / `Canceled` → `SERVICE_UNAVAILABLE` 503, `NotFound` →
   `NOT_FOUND`, `InvalidArgument` → `VALIDATION_FAILED`, bilinmeyen → `INTERNAL`.

Servisin kendi mesajı ve asıl hata istemciye gitmez, `istek hatayla dondu` günlük satırına
yazılır (4xx `WARN`, 5xx `ERROR`). Her gRPC çağrısı `x-request-id` metadata'sı taşır; servis
günlüğü gateway günlüğüyle aynı kimlikle eşleşir.

### Fiber hataları

Fiber'in kendi ürettiği hatalar (bilinmeyen yol, yanlış fiil, çok büyük başlık) hata
sözlüğündeki bir koda indirilir. Cevaptaki HTTP kodu **her zaman** o kodun
`@getir/core/error-codes.ts` tablosundaki karşılığıdır:

| Fiber'in ham kodu | Cevap                        |
| ----------------- | ---------------------------- |
| 404, 405          | `NOT_FOUND` 404              |
| Diğer 4xx         | `VALIDATION_FAILED` 400      |
| 5xx               | `INTERNAL` 500               |

Ham kod kaybolmaz: günlükteki `istek hatayla dondu` satırına yazılır.
