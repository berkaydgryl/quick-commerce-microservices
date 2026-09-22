# apps/gateway

Tarayıcının konuştuğu **tek dış kapı** (Go + Fiber v3). Tarayıcı hiçbir gRPC servisine
doğrudan erişemez; REST isteği burada karşılanır, doğrulanır ve gRPC çağrısına çevrilir.

Pnpm workspace'inin parçası değildir: kendi Go modülüdür (`go.mod`). `pnpm verify` bu klasörü
kapsamaz; kapısı CI'daki **`gateway`** işidir (gofmt, vet, `go mod tidy -diff`, `-race`
testleri, statik derleme).

## Bugünkü durum (T3.4 — ilk proxy)

| Parça                | Durum                                                           |
| -------------------- | --------------------------------------------------------------- |
| Env doğrulaması      | ✅ Açılışta, hatalar toplu raporlanır; geçersizse çıkış kodu 1  |
| gRPC istemci havuzu  | ✅ catalog + order, tembel bağlantı, keepalive                  |
| `GET /healthz`       | ✅ Servisleri paralel sorgular; hepsi ayaktaysa 200, değilse 503 |
| Cevap zarfı          | ✅ `packages/contracts` ile aynı biçim, her cevapta `requestId` |
| Zarif kapanış        | ✅ SIGINT/SIGTERM → devam eden istekler beklenir                |
| `GET /v1/categories` | ✅ catalog `ListCategories`; bilinmeyen sorgu parametresi 400   |
| gRPC hata çevirisi   | ✅ `x-app-error` trailer'ı, yoksa durum kodu (`apperror`)       |
| `GET /v1/products`   | ⏳ T8.4 (stok birleştirmesiyle)                                 |
| JWT, rate limit      | ⏳ T8.1, T8.2                                                   |

## Çalıştırma

Gateway, `packages/proto`'nun **üretilen** Go koduna `replace` ile bağlıdır ve `gen/` depoda
yoktur. İlk derlemeden (ve her `.proto` değişikliğinden) önce Go kodu üretilmelidir:

```bash
pnpm proto:gen                       # TS + Go (Go icin buf + protoc eklentileri gerekir)
cd apps/gateway
go run ./cmd/gateway                 # :8080
curl -s localhost:8080/v1/categories | jq
curl -s localhost:8080/healthz | jq
go test -race ./...
```

Docker (build bağlamı **depo köküdür**):

```bash
docker build -f apps/gateway/Dockerfile -t getir/gateway .
docker run --rm -p 8080:8080 \
  -e CATALOG_GRPC_ADDR=host.docker.internal:50051 \
  -e ORDER_GRPC_ADDR=host.docker.internal:50053 \
  getir/gateway
```

İmaj `distroless/static:nonroot` üzerindedir (~28 MB). İçinde kabuk olmadığı için Docker
`HEALTHCHECK`'i ikilinin kendi alt komutunu çağırır: `/gateway healthcheck`.

## Ortam değişkenleri

| Değişken                     | Varsayılan        | Anlamı                                          |
| ---------------------------- | ----------------- | ----------------------------------------------- |
| `GATEWAY_PORT`               | `8080`            | Dinlenen HTTP portu                             |
| `CATALOG_GRPC_ADDR`          | `localhost:50051` | catalog-service adresi (`host:port`)            |
| `ORDER_GRPC_ADDR`            | `localhost:50053` | order-service adresi                            |
| `GATEWAY_REQUEST_TIMEOUT_MS` | `5000`            | Tek bir servis çağrısının üst sınırı            |
| `GRPC_SHUTDOWN_TIMEOUT_MS`   | `10000`           | Kapanışta devam eden istekler için bekleme      |
| `LOG_LEVEL`                  | `info`            | `trace/debug/info/warn/error/fatal` (Node ile ortak) |
| `MOCK`                       | `false`           | `/healthz` cevabında bildirilir (B16)           |
| `NODE_ENV`                   | `development`     | `development/test/production`                   |

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
   kod ve `details` (yalnızca metin → metin nesnesi; başka biçim düşürülür).
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
