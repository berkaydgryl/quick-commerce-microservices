# @getir/observability

Gözlemlenebilirliğin dört parçası burada: **günlük** (pino), **korelasyon kimliği** (request-id),
**iz** (OpenTelemetry, D15) ve **metrik** (Prometheus). gRPC'ye bağlı değildir. Metadata'dan kimlik
okumak, RPC span'leri ve metrikleri ve metrik ucunun port kuralı `@getir/service-kit`'tedir. Servisler bu paketi çoğunlukla service-kit üzerinden
kullanır; işçi metrikleri (outbox, tüketici, süpürücü) için doğrudan import eder.

| Parça           | Dosya                     | Ne yapar                                                        |
| --------------- | ------------------------- | --------------------------------------------------------------- |
| Günlükçü        | `src/logger.ts`           | `createLogger`: tek satır JSON, ISO zaman, seviye adı           |
| stdout hedefi   | `src/log-destination.ts`  | Eşli yazar; yazamazsa günlüğü bırakır (#56)                     |
| Korelasyon      | `src/request-id.ts`       | `x-request-id` anahtarı, `resolveRequestId` (kullan ya da üret) |
| İz sağlayıcısı  | `src/tracing/provider.ts` | `startTracing`: OTLP/HTTP, W3C `traceparent`, sınırlı boşaltma  |
| Metrik defteri  | `src/metrics/registry.ts` | Sürecin tek defteri, `counter` / `gauge` / `histogram`          |
| `/metrics` ucu  | `src/metrics/server.ts`   | Node `http`; yalnızca `GET /metrics`                            |
| Test yardımcısı | `src/testing/` (alt yol)  | `@getir/observability/testing`: metrik okuma, bellek içi span   |

T10.5'te açıldı: günlükçü ve request-id service-kit'ten taşındı. service-kit ikisini **yeniden dışa
verir**; servisler `createLogger`'ı `@getir/service-kit`'ten almaya devam eder, servis kodu değişmedi.

## Günlük

```ts
const logger = createLogger({ name: 'catalog', level: env.LOG_LEVEL });
logger.info({ orderId }, 'siparis olusturuldu'); // alanlar mesajdan ÖNCE
```

`Logger` arayüzü `@getir/core`'dadır (mongo-kit ve redis-kit de günlükçü ister, bu pakete bağlanmasınlar).

**stdout eşli yazılır (#56).** pino'nun varsayılan hedefi (sonic-boom, eşzamansız) süreç çıkarken
tamponu `flushSync` ile boşaltır. stdout'un okuyucusu gittiyse (günlük toplayıcı çöktü, üst süreç
öldü) yazım `EPIPE` verir ve sonic-boom 4.2 bu döngüde EAGAIN dışındaki hatayı da tekrar dener: döngü
hiç bitmez, `SIGTERM` alan servis **çıkamaz** (T10.4 canlı testinde bulundu, MOCK serviste
yeniden üretildi; süreç `Atomics.wait` içinde takılı). Eşli hedefte tampon yoktur, çıkışta boşaltılacak
bir şey kalmaz. İlk yazım hatasında günlük **bırakılır**, stderr'e bir kez not düşülür
(`stdout'a yazilamiyor; gunluk birakildi`), süreç işine ve kapanışına devam eder. Bedeli satır başına
bir `write` çağrısı; servisler `info` seviyesinde başarılı istek başına satır yazmaz.

## İz (D15, ADR-20)

`startTracing({ serviceName, otlpEndpoint, logger })` sürecin iz sağlayıcısını kurar; servisler bunu
`startGrpcServer` üzerinden alır (`OTEL_EXPORTER_OTLP_ENDPOINT`). Sağlayıcı süreçte **tektir**: ikinci
çağrı ilk kurulumu kullanır.

- **Bağlam W3C `traceparent` ile taşınır** (yalnızca trace context). Her istek örneklenir
  (ParentBased(AlwaysOn)); üst span'in kararı korunur.
- **Adres yoksa** span'ler yine oluşur ve servisten servise taşınır, yalnızca dışarı gönderilmez.
  Adres varsa OTLP/HTTP ile `<adres>/v1/traces`'e toplu gönderilir (yerelde Jaeger, `pnpm infra:up`).
- **Span'i açan kod yalnızca `@opentelemetry/api`'yi kullanır** (service-kit). Sağlayıcısız API hiçbir
  şey yapmaz; SDK ve OTLP gönderici yalnızca bu pakette.
- **Günlük satırı iz kimliğini taşır:** pino `mixin`'i aktif span'in `traceId` ve `spanId`'sini her
  satıra ekler. Bir RPC'nin bütün satırları (use-case, giden çağrı dahil) izle eşleşir; span dışındaki
  satır (açılış, işçi turu) bu alanları taşımaz.
- **Kapanış:** `tracing.flush()` bekleyen span'leri en çok 2 sn bekler, hata fırlatmaz (service-kit
  zarif kapanışın son adımı).
- **Hata satırı seyrek:** OpenTelemetry'nin hataları (örn. Jaeger kapalı: her parti düşer) JSON
  günlüğe WARN olarak, dakikada en çok bir kez yazılır; aradakiler `suppressed` alanında.

Testte: `recordSpans()` (`@getir/observability/testing`) sağlayıcıyı bellek içi göndericiyle kurar.
Sunucudan **önce** çağrılmalıdır.

## Korelasyon kimliği

`REQUEST_ID_METADATA_KEY` (`x-request-id`) gateway'in de okuduğu anahtardır. `resolveRequestId(gelen)`
gelen değeri (baş/son boşluksuz) kullanır, yoksa `req_` + 32 onaltılık yenisini üretir. Taşıma burada
değildir: gRPC metadata'sından okumak service-kit'in `requestIdFrom`'udur. Olay zarfında taşınması D16.

## Metrik

Kütüphane **`@prometheus-io/client`**'tır: prom-client'in Prometheus organizasyonundaki devamı
(prom-client Ağustos 2026'da kullanımdan kaldırıldı, API aynı). Servisler ve paketler kütüphaneyi
doğrudan import etmez; buradaki üreticileri kullanır.

```ts
const published = counter({ name: 'outbox_events_published_total', help: '...' });
const lag = gauge({ name: 'event_consumer_lag', help: '...', labelNames: ['group'] });
const duration = histogram({ name: 'reservation_sweeper_round_duration_seconds', help: '...' });
```

Kurallar (proje kuralları, "Gözlemlenebilirlik"):

- **Ad önek taşımaz** (`getir_` yok); servis ayrımı her metrikteki **`service`** etiketiyledir
  (`startGrpcServer` koyar). Birim adın sonundadır: `_seconds`, `_total`.
- **Etiket değeri kapalı bir kümeden gelir:** RPC adı, hata kodu, olay konusu, grup. Sipariş, kullanıcı
  ya da istek kimliği, telefon, adres **etiket olmaz**. Her farklı değer yeni bir zaman serisi açar ve
  kişisel veri metrik deposuna sızar.
- Süre histogramlarının kovaları `DURATION_BUCKETS_SECONDS`: 5 ms - 10 sn.
- Defter kütüphanenin **küresel** defteridir. Paket bir sürece iki kez yüklense de (testte kaynak + dist)
  aynı deftere yazılır; üretici aynı adla ikinci kez çağrılınca var olanı döner, başka türde aynı ad
  hata verir.
- `enableProcessMetrics()` Node süreç metriklerini açar (CPU, bellek, olay döngüsü gecikmesi, GC).

**`/metrics` ucu:** `startMetricsServer({ host, port })`. `GET /metrics` Prometheus metin biçimiyle
döner, `/metrics`'e başka fiil `405` (`Allow: GET`), başka yol `404`, toplama hatası `500` (sunucu ayakta
kalır). Kapanış yeni bağlantıyı keser, boşta bekleyen bağlantıyı kapatır, süren cevabı bekler.
`METRICS_CLOSE_GRACE_MS` (1 sn) içinde bitmeyen bağlantı (yarım istekle bekleyen istemci) kesilir.
Kapanış hata fırlatmaz ve iki kez çağrılabilir. Portu servis açmaz, service-kit açar (gRPC portu + 1000).

## Test

```ts
import { metricsRegistry } from '@getir/observability';
import { histogramCount, metricValue } from '@getir/observability/testing';

beforeEach(() => metricsRegistry.resetMetrics());
expect(await metricValue('grpc_server_requests_total', { rpc: 'Reserve', code: 'OK' })).toBe(2);
expect(await histogramCount('grpc_server_request_duration_seconds')).toBe(2);
```

Her test dosyası ayrı süreçte koşar; dosyalar birbirinin metriğini görmez. Günlükçü testleri
(`logger.spec.ts`) gerçek bir alt süreçte koşar: çıktı biçimi ve #56 (okuyucusu giden stdout'ta
`SIGTERM` ile çıkış). Alt süreç paketin `dist`'ini kullanır; `pnpm verify` testten önce derler.
