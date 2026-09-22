# @getir/service-kit

Her Node servisinin **aynı şekilde** ayağa kalkması, **aynı şekilde** hata döndürmesi ve
**aynı şekilde** kapanması için ortak açılış takımı. Servisin kendi işi (`domain`,
`application`, `infrastructure`) buraya girmez; burada yalnızca her serviste birebir
tekrarlanacak olan dört parça durur:

| Parça                     | Dosya                 | Ne yapar                                              |
| ------------------------- | --------------------- | ----------------------------------------------------- |
| gRPC bootstrap            | `src/grpc/server.ts`  | Sunucuyu kurar, portu açar, zarif kapanışı yönetir    |
| Health RPC                | `src/grpc/health.ts`  | Standart `grpc.health.v1.Health` (Check + Watch)      |
| Zod doğrulama ara katmanı | `src/grpc/handler.ts` | Gelen mesajı doğrular, handler'a **tipli** veri verir |
| Hata çevirisi             | `src/grpc/status.ts`  | `AppError` ⇄ gRPC status; yığın izi dışarı çıkmaz     |

Sınır: **sözleşme** burada değil. gRPC sözleşmeleri `packages/proto`, REST/socket
şemaları `packages/contracts` içindedir (ADR-09).

## Klasör düzeni

```text
packages/service-kit/
├── proto/
│   ├── health.proto        # grpc.health.v1 - yukarı akıştan birebir kopya
│   └── echo.proto          # yalnızca örnek sunucu için
├── src/
│   ├── config/
│   │   ├── constants.ts    # metadata anahtarları, varsayılanlar, ServingStatus
│   │   └── env.ts          # serviceEnvSchema, grpcPort()
│   ├── grpc/
│   │   ├── context.ts      # HandlerContext, requestId çözümü
│   │   ├── handler.ts      # unaryHandler (Zod + hata + günlük)
│   │   ├── health.ts       # HealthService
│   │   ├── proto.ts        # çalışma zamanında .proto yükleme
│   │   ├── server.ts       # startGrpcServer, zarif kapanış
│   │   └── status.ts       # toServiceError / fromServiceError
│   ├── example/            # örnek servis (üründe kullanılmaz)
│   ├── logger.ts           # pino tabanlı Logger
│   └── shutdown.ts         # sinyaller, yakalanmamış hata
└── test/unit/
```

## Bir servis bunu nasıl kullanır

`src/config/env.ts` — ortak şema + servise özel port:

```ts
import { loadEnvOrExit } from '@getir/core';
import { grpcPort, serviceEnvSchema } from '@getir/service-kit';

const envSchema = serviceEnvSchema.extend({
  CATALOG_GRPC_PORT: grpcPort(50051),
});

export const env = loadEnvOrExit(envSchema);
```

`src/interfaces/grpc/list-products.ts` — handler ~15 satırda kalır, çünkü doğrulama,
hata çevirisi ve günlükleme ara katmandadır:

```ts
export const listProducts = unaryHandler({
  name: 'ListProducts',
  schema: listProductsRequestSchema, // Zod (ADR-10)
  logger,
  handle: async (input, ctx) => repository.list(input, ctx.requestId),
});
```

`src/main.ts` — süreç yaşam döngüsü:

```ts
const handle = await startGrpcServer({
  serviceName: 'catalog',
  host: env.GRPC_HOST,
  port: env.CATALOG_GRPC_PORT,
  shutdownTimeoutMs: env.GRPC_SHUTDOWN_TIMEOUT_MS,
  logger,
  services: [{ name: CATALOG_SERVICE_NAME, definition, implementation }],
  onShutdown: () => Promise.all([mongo.close(), redis.quit()]),
});

installProcessHandlers({ shutdown: (reason) => handle.shutdown(reason), logger });
```

## Hata sözleşmesi

Handler'dan çıkan her hata `AppError`'a çevrilir, oradan gRPC status'una. Kod → status
eşlemesi burada değil, `@getir/core` içindeki **tek tabloda** durur. Makine tarafından
okunacak bilgi `x-app-error` metadata anahtarında JSON olarak gider:

```json
{
  "code": "STOCK_INSUFFICIENT",
  "message": "Stok yetersiz",
  "details": { "sku": "SUT-1L" },
  "requestId": "req_8f2a"
}
```

Gateway REST zarfını (`{ success: false, error: { ... } }`) doğrudan bu yükten kurar.
Beklenmeyen hatalar `INTERNAL`'a düşer ve **özgün mesajları dışarı çıkmaz** — yalnızca
sunucu günlüğüne yazılır.

`grpc-status-details-bin` yerine düz JSON seçildi: standart yol `google.rpc.Status`
içine `Any` gömmeyi ister, bu da hata üreten her tarafın protobuf kodlayıcı taşımasını
ve service-kit'in `@getir/proto`'ya bağlanmasını gerektirirdi. Taşınan şey zaten sabit
ve küçük bir sözlük; hem Node hem Go tarafında tek satırda okunuyor.

## Health durumu

| An                      | `""` (sunucu) | Kayıtlı servis adı |
| ----------------------- | ------------- | ------------------ |
| Süreç başladı, port yok | `NOT_SERVING` | `NOT_SERVING`      |
| Port açıldı             | `SERVING`     | `SERVING`          |
| Kapanış başladı         | `NOT_SERVING` | `NOT_SERVING`      |

Servis kendi bağımlılığına göre durumu değiştirebilir:
`handle.health.setStatus(CATALOG_SERVICE_NAME, 'NOT_SERVING')`.

## Zarif kapanış sırası

1. Health → `NOT_SERVING` (gateway/probe yeni çağrı göndermeyi keser)
2. Açık `Watch` akışları kapatılır (yoksa sunucu hiç boşalmaz)
3. `tryShutdown`: **devam eden** çağrıların bitmesi beklenir
4. Süre aşımında `forceShutdown` (varsayılan 10 sn, `GRPC_SHUTDOWN_TIMEOUT_MS`)
5. `onShutdown`: Mongo/Redis bağlantıları **en son** kapanır

(5) sonda, çünkü (3) sırasında devam eden çağrılar hâlâ veritabanına yazıyor olabilir;
bağlantıyı önce kapatmak tam da önlemeye çalıştığımız yarım işlemi üretirdi.

## Örnek servisi çalıştırma ve grpcurl ile doğrulama

```powershell
pnpm --filter @getir/service-kit build
pnpm --filter @getir/service-kit example      # 50099 portunda dinler
```

Ayrı bir kabukta (`-proto` gerekiyor, çünkü sunucuda yansıma/reflection yok):

```powershell
grpcurl -plaintext -proto packages/service-kit/proto/health.proto `
  -d '{\"service\":\"\"}' localhost:50099 grpc.health.v1.Health/Check
# {"status": "SERVING"}

grpcurl -plaintext -proto packages/service-kit/proto/echo.proto `
  -d '{\"message\":\"merhaba\",\"repeat\":2}' localhost:50099 getir.example.v1.EchoService/Echo
# {"message": "merhaba merhaba", "servedBy": "example@1234"}

grpcurl -plaintext -proto packages/service-kit/proto/echo.proto `
  -d '{\"message\":\"\"}' localhost:50099 getir.example.v1.EchoService/Echo
# ERROR: Code: InvalidArgument  Message: Gecersiz istek
```

Aynı akışın otomatik karşılığı `test/unit/server.spec.ts` içindedir: gerçek sunucu,
gerçek istemci, dış bağımlılık yok.

## Kapsam dışı (bilinçli)

- **Metrikler** (`/metrics`, prom-client) ve request-id üretimi: `packages/observability`
  planlanıyor. `logger.ts` o paket açılınca oraya taşınacak; `Logger` arayüzü aynı
  kalacağı için çağıran taraflarda değişiklik olmayacak.
- **Mongo/Redis istemcileri**: T2.5 (`mongo-kit`, `redis-kit`).
- **Sunucu yansıması (reflection)**: grpcurl şimdilik `-proto` ile çağrılıyor. Gerçek
  servisler geldiğinde `buf build` ile üretilen tanımlayıcı kümesi üzerinden eklenebilir.
- **TLS**: servisler yalnızca iç ağda konuşur (`ServerCredentials.createInsecure`).
