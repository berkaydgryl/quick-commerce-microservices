# apps/gateway

Tarayıcının konuştuğu **tek dış kapı** (Go + Fiber v3). Tarayıcı hiçbir gRPC servisine
doğrudan erişemez; REST isteği burada karşılanır, doğrulanır ve gRPC çağrısına çevrilir.

Pnpm workspace'inin parçası değildir: kendi Go modülüdür (`go.mod`). `pnpm verify` bu klasörü
kapsamaz; kapısı CI'daki **`gateway`** işidir (gofmt, vet, `go mod tidy -diff`, `-race`
testleri, statik derleme).

## Bugünkü durum (T3.3 — iskelet)

| Parça                | Durum                                                           |
| -------------------- | --------------------------------------------------------------- |
| Env doğrulaması      | ✅ Açılışta, hatalar toplu raporlanır; geçersizse çıkış kodu 1  |
| gRPC istemci havuzu  | ✅ catalog + order, tembel bağlantı, keepalive                  |
| `GET /healthz`       | ✅ Servisleri paralel sorgular; hepsi ayaktaysa 200, değilse 503 |
| Cevap zarfı          | ✅ `packages/contracts` ile aynı biçim, her cevapta `requestId` |
| Zarif kapanış        | ✅ SIGINT/SIGTERM → devam eden istekler beklenir                |
| `GET /v1/categories` | ⏳ T3.4 (ilk proxy, `packages/proto` o gün bağlanır)            |
| JWT, rate limit      | ⏳ T8.1, T8.2                                                   |

## Çalıştırma

```bash
cd apps/gateway
go run ./cmd/gateway                 # :8080
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

## Hata eşlemesi

Fiber'in kendi ürettiği hatalar (bilinmeyen yol, yanlış fiil, çok büyük başlık) hata
sözlüğündeki bir koda indirilir. Cevaptaki HTTP kodu **her zaman** o kodun
`@getir/core/error-codes.ts` tablosundaki karşılığıdır:

| Fiber'in ham kodu | Cevap                        |
| ----------------- | ---------------------------- |
| 404, 405          | `NOT_FOUND` 404              |
| Diğer 4xx         | `VALIDATION_FAILED` 400      |
| 5xx               | `INTERNAL` 500               |

Ham kod kaybolmaz: günlükteki `istek hatayla dondu` satırına yazılır.
