# @getir/event-bus

Servisler arası olay hattı (ADR-04, ADR-07). Servis kodu Redis'i doğrudan çağırmaz;
`EventPublisher` arayüzünü görür. Taşıma bugün Redis Streams, ileride Kafka olabilir — değişen
tek şey fabrikada seçilen uygulama olur.

| Parça                                 | Ne                                                                                                |
| ------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `eventEnvelopeSchema`                 | Sabit zarf: `eventId` (`evt_…`), `topic` (core `EVENTS`), `partitionKey`, `occurredAt`, `payload` |
| `EventPublisher`                      | `publish(envelope)`: başarı = olay kalıcı olarak hatta                                            |
| `RedisStreamsPublisher`               | `XADD stream:events MAXLEN ~ 10000 * …`; bozuk zarf hatta girmez (`INTERNAL`)                     |
| `toStreamFields` / `fromStreamFields` | Zarf ↔ stream alanları; payload JSON. Okuma tarafı Zod'dan geçer                                  |
| `InMemoryEventPublisher`              | Testler için bellek içi yayıncı (MOCK modunda yayıncı hiç kurulmaz)                               |

**Teslimat en az bir kezdir:** olayı üreten servis outbox'tan yayınlar (ADR-04). Yayınla ile
"yayınlandı" işareti arasında çökerse olay ikinci kez gider; tüketici `eventId` ile tekilleştirir.

**Kapsam:** T7.3'te yalnızca yayın (outbox yayıncısı için). Dinleme — `subscribe(topic, group,
handler)`, tüketici grubu, onay ve yeniden teslim — T7.4'te bu pakete eklenir.

Testler: `test/unit` (zarf, alan çevirisi) ve `test/integration` (gerçek Redis, Testcontainers).
