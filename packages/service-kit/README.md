# @getir/service-kit

Her Node servisinin **aynı şekilde** ayağa kalkması, **aynı şekilde** hata döndürmesi ve
**aynı şekilde** kapanması için ortak açılış takımı. Servisin kendi işi (`domain`,
`application`, `infrastructure`) buraya girmez; burada yalnızca her serviste birebir
tekrarlanacak olan dört parça durur:

| Parça                     | Dosya                           | Ne yapar                                                 |
| ------------------------- | ------------------------------- | -------------------------------------------------------- |
| gRPC bootstrap            | `src/grpc/server.ts`            | Sunucuyu kurar, portu açar, SERVING'e çevirir            |
| Metrik ucu (T10.5)        | `src/grpc/metrics-endpoint.ts`  | gRPC portu + 1000'de HTTP `/metrics`                     |
| RPC metrikleri (T10.5)    | `src/grpc/rpc-metrics.ts`       | İstek sayacı ve süre histogramı (`rpc`, `code`)          |
| Zarif kapanış             | `src/grpc/graceful-shutdown.ts` | Altı adımlık kapanış sırası, drenaj ve üst süre          |
| Health durumu             | `src/health/registry.ts`        | Kim ayakta? Durum tablosu + abonelik (gRPC'den bağımsız) |
| Health RPC                | `src/grpc/health.ts`            | Standart `grpc.health.v1.Health` (Check + Watch)         |
| Zod doğrulama ara katmanı | `src/grpc/handler.ts`           | Gelen mesajı doğrular, handler'a **tipli** veri verir    |
| Hata çevirisi             | `src/grpc/status.ts`            | `AppError` ⇄ gRPC status; yığın izi dışarı çıkmaz        |
| Yazılmamış RPC            | `src/grpc/unimplemented.ts`     | `NOT_IMPLEMENTED` (HTTP 501), standart hata yolundan     |
| grpc-js günlükleri        | `src/grpc/grpc-logging.ts`      | Kütüphanenin düz metin satırları JSON günlükçüye         |
| Test yardımcıları         | `src/testing/` (alt yol)        | `@getir/service-kit/testing`: test sunucusu, çağrı, hata |

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
│   │   ├── context.ts             # HandlerContext, requestId çözümü
│   │   ├── graceful-shutdown.ts   # kapanış sırası + drenaj
│   │   ├── grpc-logging.ts        # grpc-js günlüklerini JSON günlükçüye bağlar (D5)
│   │   ├── handler.ts             # unaryHandler (Zod + hata + günlük + metrik)
│   │   ├── health.ts              # HealthGrpcService (taşıma)
│   │   ├── metrics-endpoint.ts    # metrik ucunun port kuralı ve açılışı (T10.5)
│   │   ├── proto.ts               # çalışma zamanında .proto yükleme
│   │   ├── request.ts             # parseRequest: unary ve Watch aynı kapıdan (D5)
│   │   ├── rpc-metrics.ts         # grpc_server_requests_total + süre histogramı (T10.5)
│   │   ├── server.ts              # startGrpcServer (açılış)
│   │   ├── status.ts              # toServiceError / fromServiceError
│   │   ├── types.ts               # sunucu seçenekleri ve tutamağı
│   │   └── unimplemented.ts       # yazılmamış RPC: NOT_IMPLEMENTED (D5)
│   ├── testing/                   # @getir/service-kit/testing (yalnızca testler, D5)
│   ├── health/
│   │   └── registry.ts            # HealthRegistry (durum + abonelik)
│   ├── example/                   # örnek servis (üründe kullanılmaz)
│   ├── logger.ts                  # createLogger: @getir/observability'den yeniden dışa verir
│   ├── shutdown.ts                # sinyaller, yakalanmamış hata
│   └── startup.ts                 # startOrExit: açılış hatası → tek satır fatal JSON
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

Use-case günlük yazıyorsa handler ona `ctx.logger`'ı geçirir (`deps.charge(input, ctx.logger)`):
bu günlükçüye `rpc` ve `requestId` bağlıdır. Servis geneli günlükçüyle yazılan satırda
requestId olmaz ve hata hangi isteğe ait bulunamaz.

`src/main.ts` — süreç yaşam döngüsü. Açılış adımları `startOrExit` ile sarılır: veri
kaynağına ulaşılamaz ya da port doluysa hata düz metin yığın izi yerine tek satır
`fatal` JSON olarak yazılır ve süreç 1 koduyla kapanır:

```ts
const handle = await startOrExit(
  () =>
    startGrpcServer({
      serviceName: 'catalog',
      host: env.GRPC_HOST,
      port: env.CATALOG_GRPC_PORT,
      shutdownTimeoutMs: env.GRPC_SHUTDOWN_TIMEOUT_MS,
      logger,
      services: [{ name: CATALOG_SERVICE_NAME, definition, implementation }],
      onShutdown: () => Promise.all([mongo.close(), redis.quit()]),
    }),
  { logger },
);

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

Karşı servisten gelen yük **dış veridir**: `fromServiceError` onu Zod şemasından geçirir
(D5); bilinmeyen kod ya da eksik mesaj yükü geçersiz kılar ve gRPC durum kodundan en yakın
koda düşülür. Durum → kod eşlemesi gateway'deki kopyasıyla (`apps/gateway/internal/apperror/grpc.go`)
**aynı** kalmalıdır.

**Yazılmamış RPC (`unimplemented`, D5):** sözleşmede olup henüz yazılmayan ya da kullanımdan
kalkan uç `unimplemented('GetProduct', 'T8.4', logger)` ile bağlanır. Cevap diğer hatalarla
aynı yoldan gider: gRPC `UNIMPLEMENTED`, `x-app-error`'da `NOT_IMPLEMENTED` (gateway'de
HTTP 501), mesaj hangi görevde geleceğini ya da yerine neyin kullanılacağını söyler,
`x-request-id` taşınır, çağrı WARN yazılır. Uygulaması hiç verilmeyen metoda grpc-js kendi
cevabını döner (yüksüz, gateway'de 500); bu yüzden boş bırakılmaz.

**Günlük seviyesi kodun ağırlığından (#49):** `unaryHandler` hatayı `@getir/core`
`ERROR_CODE_SEVERITY` tablosuna göre yazar. Seviye gRPC durum numarasından **türetilmez**:
UNAUTHENTICATED (16) sayıca INTERNAL'dan büyük ama bir iş sonucudur.

| Ağırlık     | Kodlar                                   | Satır                                     |
| ----------- | ---------------------------------------- | ----------------------------------------- |
| beklenen    | iş sonucu: stok yok, kupon, oturum yok…  | `info` · `rpc is hatasiyla dondu`         |
| sıradışı    | `SERVICE_UNAVAILABLE`, `NOT_IMPLEMENTED` | `warn` · `rpc siradisi hatayla dondu`     |
| beklenmeyen | `INTERNAL` ve AppError olmayan her hata  | `error` · `rpc beklenmeyen hatayla dondu` |

Beklenen iş sonucu arıza değildir: satır hata nesnesini (yığın izini) taşımaz. Sıradışı ve beklenmeyen
satırlar `err` alanını taşır. Önce her AppError `warn`, gRPC durumu INTERNAL ve üstü `error` +
"beklenmeyen" yazılıyordu. Bağımlı servisin geçici yokluğu (`SERVICE_UNAVAILABLE`) beklenmeyen arıza
gibi görünüyordu, 100 kişilik son kutu yarışı 99 `warn` satırı üretiyordu.

**grpc-js günlükleri (D5):** grpc-js varsayılan olarak stderr'e düz metin yazar (dolu portta
`E No address added…`). `startGrpcServer` port açmadan önce grpc-js'in günlükçüsünü servisin
günlükçüsüne bağlar: satırlar `source: "grpc-js"` alanıyla JSON olarak, WARN seviyesinde
yazılır (kütüphane teşhisi; sonucu servis kodu kendi seviyesiyle yazar). Hangi satırların
geleceğini `GRPC_VERBOSITY` / `GRPC_TRACE` belirler (varsayılan yalnızca ERROR).

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

`Watch` isteği de `Check` ile aynı şemadan geçer (D5): geçersiz istek akışı
`INVALID_ARGUMENT` ile kapatır, abonelik hiç açılmaz. İstemci akışı iptal edince abonelik
bırakılır (testli).

## Metrikler ve `/metrics` ucu (T10.5)

`startGrpcServer` gRPC portunu açtıktan sonra **gRPC portu + 1000**'de HTTP `/metrics` açar (catalog
50051 → 51051; testte gRPC portu 0 ise metrik ucu da boş bir portta). Ayrı ortam değişkeni yoktur:
kural sabit, port tahmin edilir. Bu yüzden `grpcPort()` en fazla **64535** kabul eder. Her metriğe
`service` etiketi eklenir, Node süreç metrikleri açılır. Port doluysa açılış durur (`metrik portu
acilamadi`) ve açılmış gRPC portu bırakılır. Servis kodu bir şey yapmaz; `handle.metricsPort` gerçek
portu verir.

```bash
curl -s localhost:51051/metrics | grep grpc_server_requests_total
# grpc_server_requests_total{rpc="ListCategories",code="OK",service="catalog"} 3
```

| Metrik                                 | Tür       | Etiketler     |
| -------------------------------------- | --------- | ------------- |
| `grpc_server_requests_total`           | sayaç     | `rpc`, `code` |
| `grpc_server_request_duration_seconds` | histogram | `rpc`, `code` |

`code` başarıda `OK`, hatada AppError kodudur (kapalı liste; AppError olmayan hata `INTERNAL`).
**Kimlik, kullanıcı ya da istek verisi etiket olmaz.** Ad ve etiket kuralı `@getir/observability`
README'sinde. İşçi metrikleri (outbox, tüketici, süpürücü) aynı uçtan görünür; tanımları sahibi
olan servistedir.

## Zarif kapanış sırası

1. Health → `NOT_SERVING` (gateway/probe yeni çağrı göndermeyi keser)
2. Açık `Watch` akışları kapatılır (yoksa sunucu hiç boşalmaz)
3. `tryShutdown`: **devam eden** çağrıların bitmesi beklenir
4. Süre aşımında `forceShutdown` (varsayılan 10 sn, `GRPC_SHUTDOWN_TIMEOUT_MS`)
5. Metrik ucu kapanır (T10.5): drenaj boyunca açıktı, son kazıma kapanışı da görür
6. `onShutdown`: işçiler ve Mongo/Redis bağlantıları **en son** kapanır; 10 sn'de
   (`DEFAULT_SHUTDOWN_HOOK_TIMEOUT_MS`) bitmezse **beklenmez** (#56)

(6) sonda, çünkü (3) sırasında devam eden çağrılar hâlâ veritabanına yazıyor olabilir;
bağlantıyı önce kapatmak tam da önlemeye çalıştığımız yarım işlemi üretirdi.

**Üst süre (#56):** her adım sınırlıdır. Kapanış en geç drenaj (`GRPC_SHUTDOWN_TIMEOUT_MS`), metrik
ucu (1 sn) ve kanca (10 sn) toplamında biter ve süreç çıkar: varsayılanlarla 21 sn, Kubernetes'in 30
sn'lik penceresinin içinde. Takılmış bir Mongo kapanışı ya da işçi turu süreci ayakta tutmaz: kanca
süresinde bitmezse `kapanis kancasi suresinde bitmedi; beklenmiyor` (ERROR) yazılır, son satır
`zarif kapanis bitti` `hook: "timed-out"` taşır. stdout'un okuyucusu gitse de kapanış sürer: günlük
eşli yazılır ve yazım hatasında bırakılır (`@getir/observability`, #56).

Test edilen yollar (D5): süre aşımında zorla kapanış (bitmeyen çağrı kesilir, kapanış yine
biter), kapanış kancasının hatası (ERROR yazılır, kapanış tamamlanır), yakalanmamış hata ve
yakalanmamış söz reddi (`unhandledRejection`; `FATAL`, kapanış denenir, çıkış kodu 1). T10.5:
kanca süresinde bitmezse beklenmez, metrik ucu kancadan önce kapanır, stdout'un okuyucusu giden
servis `SIGTERM` ile çıkar (`stdout-closed.spec.ts`, gerçek alt süreç).

## Test yardımcıları (`@getir/service-kit/testing`, D5)

Paketin ana girişinde **yoktur**; yalnızca testler alt yoldan içe aktarır. vitest'e bağlı
değildir: `beforeAll` / `afterAll` kancalarını test dosyası kurar.

| Yardımcı                             | Ne                                                                  |
| ------------------------------------ | ------------------------------------------------------------------- |
| `startTestGrpcServer({ services })`  | Boş portta sunucu + bağlı istemci + tipli `call` + `stop`           |
| `unaryCall(client, method, request)` | Sözleşmenin (ts-proto) serialize/deserialize'ıyla tipli unary çağrı |
| `appErrorOf(error)`                  | `x-app-error`'ın iş anlamı: `{ code, details? }`                    |
| `appErrorPayloadOf(error)`           | Tam yük: kod, mesaj, ayrıntı, requestId                             |

Hata okuyucuları üretimdeki çözücüyü (`status.ts`) **kullanmaz**: testin doğrulaması test
edilen kodla aynı hatayı paylaşmasın. Önceden sekiz ayrı çağrı sarmalayıcısı ve yedi hata
okuyucu kopyası vardı. Kayıt tutan günlükçü `@getir/core/testing`'tedir (`recordingLogger`).

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

- **Günlükçü ve request-id kuralı** T10.5'ten beri `@getir/observability`'de; buradan yeniden dışa
  verilir (`createLogger`, `REQUEST_ID_METADATA_KEY`), çağıran taraflar değişmedi.
- **Dağıtık izleme** (OpenTelemetry): D15.
- **Mongo/Redis istemcileri**: T2.5 (`mongo-kit`, `redis-kit`).
- **Sunucu yansıması (reflection)**: grpcurl şimdilik `-proto` ile çağrılıyor. Gerçek
  servisler geldiğinde `buf build` ile üretilen tanımlayıcı kümesi üzerinden eklenebilir.
- **TLS**: servisler yalnızca iç ağda konuşur (`ServerCredentials.createInsecure`).
