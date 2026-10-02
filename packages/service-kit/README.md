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
| RPC izleri (D15)          | `src/grpc/tracing.ts`           | Sunucu ve istemci span'i, `traceparent` metadata'da      |
| Zarif kapanış             | `src/grpc/graceful-shutdown.ts` | Yedi adımlık kapanış sırası, drenaj ve üst süre          |
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
│   │   ├── circuit-breaker.ts     # bağımlı servise devre kesici (D17)
│   │   ├── client-metrics.ts      # devre durumu, reddedilen çağrı, yeniden deneme metrikleri (D17)
│   │   ├── server.ts              # startGrpcServer (açılış)
│   │   ├── tracing.ts             # sunucu/istemci span'i, traceparent (D15)
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

## Giden çağrının dayanıklılığı (D17)

`callUnary`'nin iki isteğe bağlı seçeneği var; ikisi de verilmezse yalnızca süre sınırı geçerlidir.

- **`breaker` (devre kesici):** `new CircuitBreaker({ target, failureThreshold, openMs, logger })`,
  her bağımlı servise bir tane. Üst üste `failureThreshold` "ulaşılamaz" hatada devre açılır ve
  `openMs` boyunca çağrı ağa hiç gitmeden `SERVICE_UNAVAILABLE` alır. Süre dolunca tek bir deneme
  çağrısına izin verilir: cevap gelirse devre kapanır, gelmezse yeniden açılır. Açılış WARN,
  kapanış INFO satırıdır.
- **Neyin hata sayıldığı:** yalnızca `SERVICE_UNAVAILABLE` sınıfı (bağlantı yok, süre doldu,
  karşı taraf hizmet veremiyor). İş hataları (kart reddi, stok yetmedi, doğrulama) servisin
  çalıştığını gösterir; devreyi açmaz, aksine sayacı sıfırlar.
- **`retry` (yeniden deneme):** `{ target, maxRetries, baseDelayMs }`. **Yalnızca idempotent
  çağrıda** verilir (anahtarlı ya da okuma). Yalnızca "ulaşılamaz" sınıfında denenir. Denemeler
  çağrının **tek süre sınırını paylaşır**, yani toplam süre `timeoutMs`'i aşmaz. Bekleme üstel artar
  ve rastgele kaydırılır; kalan süre 50 ms'nin altındaysa deneme başlatılmaz.
- **Metrikler** (`client-metrics.ts`):
  - `grpc_client_breaker_state{target}`: 0 kapalı, 1 yarı açık, 2 açık;
  - `grpc_client_breaker_rejected_total{target}`;
  - `grpc_client_retries_total{target}`.

  Etiket yalnızca bağımlı servisin adıdır.

## İzler (D15, ADR-20)

`startGrpcServer` iz sağlayıcısını kurar (`otlpEndpoint`; servislerde `OTEL_EXPORTER_OTLP_ENDPOINT`).
Adres yoksa span'ler yine oluşur ve taşınır, yalnızca dışarı gönderilmez.

- **Sunucu span'i** (`unaryHandler`): üst span gelen `traceparent` metadata'sından. Ad tam metot
  (`getir.order.v1.OrderService/CreateOrder`); nitelikler `rpc.system`, `rpc.service`, `rpc.method`,
  `rpc.grpc.status_code`, `app.request_id`, hata varsa `app.error_code`. Handler span'in bağlamında
  koşar: günlük satırı `traceId` taşır, giden çağrı bu span'in çocuğu olur.
- **İstemci span'i** (`callUnary`'nin çağrı ara katmanı): `traceparent` metadata'ya yazılır; karşı
  servisin sunucu span'i bunun çocuğu olur. Çağıranların kodu değişmedi.
- **Hata işareti ağırlıktan:** beklenen iş sonucu (stok yok, doğrulama) span'i hatalı işaretlemez;
  sıradışı ve beklenmeyen `ERROR`, beklenmeyenin istisnası da kaydedilir. İstemci tarafında karşı
  tarafın `x-app-error` kodu okunur.
- Yalnızca `@opentelemetry/api` kullanılır; SDK `@getir/observability`'dedir. Health RPC'leri izlenmez.
- **Bağlamda `requestId` (D16):** handler'ın bağlamı istek kimliğini de taşır
  (`activeRequestId()`); outbox yazıcısı gibi altyapı kodu olayı doğuran isteği oradan okur
  (`currentCorrelation()`, `@getir/observability`). Use-case'e parametre eklenmez.

## Zarif kapanış sırası

1. Health → `NOT_SERVING` (gateway/probe yeni çağrı göndermeyi keser)
2. Açık `Watch` akışları kapatılır (yoksa sunucu hiç boşalmaz)
3. `tryShutdown`: **devam eden** çağrıların bitmesi beklenir
4. Süre aşımında `forceShutdown` (varsayılan 10 sn, `GRPC_SHUTDOWN_TIMEOUT_MS`)
5. Metrik ucu kapanır (T10.5): drenaj boyunca açıktı, son kazıma kapanışı da görür
6. `onShutdown`: işçiler ve Mongo/Redis bağlantıları kapanır; 10 sn'de
   (`DEFAULT_SHUTDOWN_HOOK_TIMEOUT_MS`) bitmezse **beklenmez** (#56)
7. Bekleyen span'ler gönderilir (D15; en çok 2 sn)

(6) sonda, çünkü (3) sırasında devam eden çağrılar hâlâ veritabanına yazıyor olabilir;
bağlantıyı önce kapatmak tam da önlemeye çalıştığımız yarım işlemi üretirdi.

**Üst süre (#56):** her adım sınırlıdır. Kapanış en geç drenaj (`GRPC_SHUTDOWN_TIMEOUT_MS`), metrik
ucu (1 sn), kanca (10 sn) ve izler (2 sn) toplamında biter ve süreç çıkar: varsayılanlarla 23 sn,
Kubernetes'in 30 sn'lik penceresinin içinde. Takılmış bir Mongo kapanışı ya da işçi turu süreci ayakta tutmaz: kanca
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
- **Mongo/Redis istemcileri**: T2.5 (`mongo-kit`, `redis-kit`).
- **Sunucu yansıması (reflection)**: grpcurl şimdilik `-proto` ile çağrılıyor. Gerçek
  servisler geldiğinde `buf build` ile üretilen tanımlayıcı kümesi üzerinden eklenebilir.
- **TLS**: servisler yalnızca iç ağda konuşur (`ServerCredentials.createInsecure`).
