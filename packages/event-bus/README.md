# @getir/event-bus

Servisler arası olay hattı (ADR-04, ADR-07). Servis kodu Redis'i doğrudan çağırmaz;
`EventPublisher` ve `EventSubscriber` arayüzlerini görür. Taşıma bugün Redis Streams, ileride
Kafka olabilir — değişen tek şey fabrikada seçilen uygulama olur.

| Parça                                                  | Ne                                                                                           |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| `eventEnvelopeSchema` · `validCorrelation`             | Zarf: beş sabit alan + isteğe bağlı `requestId`, `traceparent` (D16)                         |
| `EventPublisher` · `RedisStreamsPublisher`             | `publish(envelope)`: `XADD stream:events MAXLEN ~ 10000 * …`; bozuk zarf hatta girmez (T7.3) |
| `EventSubscriber` · `EventConsumer`                    | `subscribe(topic, group, handler)`; `start()` / `stop()` (T7.4)                              |
| `RedisStreamsConsumer`                                 | Tüketici grubu, onay, yeniden teslim, çöken tüketicinin devri, ölü olaylar (T7.4)            |
| `EVENT_HANDLED` · `rejectEvent`                        | İşleyicinin cevabı: işlendi / kalıcı ret                                                     |
| `DEFAULT_DELIVERY_SETTINGS` · `GROUP_START`            | Taşımaya özgü ince ayarlar (ADR-07: arayüzün dışında, yapılandırmayla)                       |
| `DEAD_LETTER_FIELD` · `DEAD_LETTER_REASON`             | Ölü olay kaydının alan düzeni (`stream:events:dead`, ADR-16)                                 |
| `toStreamFields` · `fromStreamFields` · `peekEnvelope` | Zarf ↔ stream alanları; okuma Zod'dan geçer, `peekEnvelope` yalnızca kimlik ve konuya bakar  |
| `InMemoryEventPublisher`                               | Testler için bellek içi yayıncı (MOCK modunda yayıncı ve tüketici hiç kurulmaz)              |

Olayların **gövde şemaları** burada değil, `@getir/contracts` `events.ts`'tedir: üreten servis
gövdeyi o tipten kurar, tüketen aynı şemadan geçirir (bugün `payment.refund_requested`).

## Korelasyon ve iz (D16, ADR-07 eki, ADR-20)

Zarfın beş alanı (`eventId` `evt_…`, `topic` core `EVENTS`, `partitionKey`, `occurredAt`, `payload`)
sabittir; zarf yalnızca **isteğe bağlı** iki alanla genişler:

| Alan          | Ne                                                                        |
| ------------- | ------------------------------------------------------------------------- |
| `requestId`   | Olayı doğuran isteğin kimliği (`req_` + 32 hex)                           |
| `traceparent` | Olayı yayınlayan span'in W3C bağlamı: tüketicinin span'i onun çocuğu olur |

- **Yayın:** her `publish` bir PRODUCER span'idir (`publish <konu>`). Üst span zarftaki
  `traceparent`'tır (order'da outbox satırına saklanan istek bağlamı), yoksa aktif bağlam; akışa
  yazılan `traceparent` yayın span'inindir.
- **İşleme:** işleyiciye verilen her teslim bir CONSUMER span'idir (`process <konu>`), üstü zarftaki
  `traceparent`. İşleyici span'in ve `requestId`'nin bağlamında koşar: günlük satırı `requestId`,
  `traceId` ve `spanId` taşır, giden çağrısı (`callUnary`) bu span'in çocuğu olur. Zarfta
  `requestId` yoksa (eski kayıt) tüketici yenisini üretir. Ret ve geçici hata span'i `ERROR`
  işaretler; her yeniden deneme ayrı span'dir. Grubun dinlemediği konu span açmaz.
- **Nitelikler** izin listelidir: `messaging.system`, `messaging.operation.type`,
  `messaging.destination.name` (konu), `messaging.message.id` (`eventId`),
  `messaging.consumer.group.name`, `app.delivery_attempt`, `app.request_id`, hatada
  `app.error_code` (`MESSAGING_ATTRIBUTES`). Gövde ize yazılmaz.
- **Korelasyon olayı takmaz:** biçimsiz alan yayında atılır (`validCorrelation`; outbox durmaz),
  okumada atılır (olay ölü olaylara gitmez). Yeniden deneme ve ölü olay satırları da `requestId`
  taşır; ölü olay kopyası iki alanı korur (yeniden oynatılan olay aynı izde).

## Dinleme (T7.4)

```ts
const consumer = new RedisStreamsConsumer({
  connect: () => connectRedis({ url, name: 'payment-events', logger }), // grup başına bir bağlantı
  consumerName: `${hostname()}-${process.pid}`, // grup içinde tekil
  logger,
});
consumer.subscribe(EVENTS.PAYMENT_REFUND_REQUESTED, 'payment', handler); // start'tan ÖNCE
await consumer.start();
// kapanışta: yeni okuma başlamaz, eldeki parti biter, bağlantılar kapanır
await consumer.stop();
```

- **Grup = servis adı.** Bir grubun her olayı grubun **tek** tüketicisine gider: servisin
  kopyaları işi paylaşır. Farklı gruplar aynı olayı ayrı ayrı alır (payment ve ileride realtime).
- **Tek akış, tüm konular:** grup `stream:events`'teki her kaydı okur; dinlemediği konuyu işleyiciye
  vermeden onaylar (tur sonunda tek `XACK`). Kayıtlar bu yüzden `start`'tan önce yapılır.
- **Grup başına ayrı bağlantı:** `XREADGROUP BLOCK` beklerken bağlantı başka komut çalıştıramaz.
- **Her tur:** önce **takılanlar** — en az `claimIdleMs` onaylanmamış kayıtlar (çöken ya da geçici
  hata alan tüketicinin) **tek tek** `XCLAIM` ile alınır; toplu almak, işleyiciyi çökerten bir
  kayıt yüzünden diğerlerinin hakkını da yakardı. Sonra **yeniler** `XREADGROUP BLOCK` ile okunur.
- **Grup ilk kez kurulurken** varsayılan akışın başından okur (`GROUP_START.BEGINNING`): tüketici
  kapalıyken bırakılmış komut kaybolmaz. Var olan grubun konumu değişmez. Eski olayın anlamı
  olmayan bildirimler (realtime) `LATEST` seçebilir.
- **Redis verisi silinirse** (`NOGROUP`: akış silindi, Redis verisiz açıldı) grup yeniden kurulur;
  Redis koparsa tur hatası WARN yazılır, `retryDelayMs` beklenip devam edilir.

### İşleyicinin cevabı ne olur

| İşleyici                                                         | Kayıt                                                     | Günlük |
| ---------------------------------------------------------------- | --------------------------------------------------------- | ------ |
| `EVENT_HANDLED` döner                                            | `XACK`                                                    | —      |
| `rejectEvent(sebep, hata?)` döner (tekrar denemek boşuna)        | beklemeden ölü olaylara (`rejected`), `XACK`              | ERROR  |
| hata fırlatır, hak var (geçici: veritabanı kapalı)               | onaylanmaz; `claimIdleMs` sonra yeniden (`attempt + 1`)   | WARN   |
| hata fırlatır, son hak                                           | ölü olaylara (`max_deliveries`), `XACK`                   | ERROR  |
| — dinlenmeyen konu                                               | `XACK` (tur sonunda toplu)                                | —      |
| — dinlenen konu ama zarfa uymuyor / konu alanı yok               | işleyiciye verilmeden ölü olaylara (`malformed`)          | ERROR  |
| — hakkı önceki teslimlerde bitmiş (tüketici her seferinde çöktü) | işleyiciye **verilmeden** ölü olaylara (`max_deliveries`) | ERROR  |

Teslimat **en az bir kezdir**: işleyici aynı olayı iki kez görebilir, tekrar-güvenli yazılır
(`eventId` ya da iş anahtarıyla). İşleyicinin günlükçüsü `eventId`, `topic`, grup ve deneme taşır.

### Ayarlar (`DEFAULT_DELIVERY_SETTINGS`)

| Ayar            | Varsayılan  | Anlamı                                                                                                                  |
| --------------- | ----------- | ----------------------------------------------------------------------------------------------------------------------- |
| `groupStart`    | `beginning` | Grup ilk kurulurken nereden okunur                                                                                      |
| `batchSize`     | 50          | Turda okunan (ve takılanlardan alınan) en fazla kayıt                                                                   |
| `blockMs`       | 2 000       | Yeni olay bekleme süresi; kapanış en fazla bu kadar gecikir. `0` reddedilir (sonsuz bekler)                             |
| `claimIdleMs`   | 30 000      | Geçici hatadan sonra yeniden deneme aralığı ve çöken tüketicinin devri. İşleyicinin en uzun süresinden **büyük** olmalı |
| `maxDeliveries` | 5           | Bir olay işleyiciye en fazla kaç kez verilir                                                                            |
| `retryDelayMs`  | 1 000       | Tur hatasından (Redis koptu) sonra bekleme                                                                              |

### Metrikler (T10.5, #12)

Tüketici, servisin `/metrics` ucuna (gRPC portu + 1000) şunları yazar:

| Metrik                                             | Anlamı                                                          |
| -------------------------------------------------- | --------------------------------------------------------------- |
| `event_consumer_events_total{group,topic,outcome}` | Sonuçlanan olay; `outcome`: `handled` · `retry` · `dead`        |
| `event_consumer_lag{group}`                        | Gruba **hiç teslim edilmemiş** kayıt (`XINFO GROUPS` lag)       |
| `event_consumer_pending{group}`                    | Teslim edilmiş ama onaylanmamış kayıt (işleniyor ya da takıldı) |

Grubun dinlemediği konu (onaylanıp geçilen) sayılmaz. `topic` grubun dinlediği konudur; konusu
okunamayan kayıt (kırpılmış, bozuk) `unknown` olur. Kimlik etiket olmaz. `lag` ve `pending` **grup
geneldir**: aynı gruptaki her kopya aynı değeri yazar (Prometheus'ta `max` ile okunur). Döngü onları en
fazla 5 sn'de bir okur (`GROUP_STATS_INTERVAL_MS`); okuma hatası turu durdurmaz, metrik eski
değerinde kalır. Redis lag'i hesaplayamazsa (akıştan silme sonrası) son değer yerinde kalır.

## Ölü olaylar (`stream:events:dead`, ADR-16)

Kayıt olayın **orijinal alanlarını aynen** taşır ve `dead.` önekli üst veri ekler:
`dead.sourceId` (kaynak kaydın kimliği), `dead.group`, `dead.consumer`, `dead.reason`
(`rejected` · `max_deliveries` · `malformed` · `trimmed`), `dead.attempts`, `dead.error` (en fazla
500 karakter), `dead.at`. Akış `MAXLEN ~ 1000` ile sınırlıdır; asıl alarm ERROR günlüğüdür.

```bash
redis-cli XRANGE stream:events:dead - +            # incele
redis-cli XLEN stream:events:dead
```

**Elle yeniden oynatma:** kaydın `dead.` ile başlamayan alanlarını aynı sırayla `stream:events`'e
geri yaz (`XADD stream:events '*' eventId … topic … partitionKey … occurredAt … payload '…'`).
Olay **tüm gruplara** yeniden gider; işleyiciler tekrar-güvenli olduğu için zararsızdır. Yordam
entegrasyon testinde sınanır. Otomatik bir yeniden oynatma aracı henüz yok (bekleyen iş).

## Bilinen sınırlar

- **Sıra:** yeniden teslim edilen olay, sonra gelenlerden sonra işlenebilir. Sıraya duyarlı
  tüketici (realtime) payload'daki `version` ile eskiyi ayıklar.
- **Kırpma:** grup ~10 000 olay geride kalırsa okunmamış kayıt akıştan düşer (Redis bekleyenlerden
  de siler). Kalıcı kayıt üreticinin outbox'ındadır (ADR-04).
- **Yarı açık bağlantı:** ağ sessizce koparsa (FIN gelmeden) okuma turu takılabilir; ioredis'te
  istemci tarafı komut zaman aşımı açık değil. redis-kit'in genel konusu (bekleyen iş).
- **Ölü tüketici adı:** çöken süreç grupta adını bırakır (kaydını başka tüketici devralır); zarif
  kapanışta bekleyeni yoksa ad silinir.

Testler: `test/unit` (tek kaydın kararı, ölü olay düzeni, sahte akışla grup döngüsü, kayıt ve
ayar kuralları, zarf, metrikler) ve `test/integration` (gerçek Redis: teslim, gruplar, yeniden teslim,
ölü olaylar, çöken tüketicinin devri, kapanış, akışın silinmesi, yeniden oynatma, `XINFO GROUPS` ve
tüketici metrikleri).
