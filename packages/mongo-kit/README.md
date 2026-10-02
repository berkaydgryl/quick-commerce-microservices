# @getir/mongo-kit

MongoDB'ye bakan üç şey burada: **bağlantı**, **repository tabanı** ve **hata çevirisi**.
Hangi koleksiyonun hangi alanları taşıdığı bu pakette yazmaz — o, sahibi servisin işidir
(ADR-05).

## Ortam: servis başına veritabanı ve kullanıcı (D14)

Her servisin **kendi veritabanı** ve **kendi Mongo kullanıcısı** vardır; kullanıcı yalnızca kendi
veritabanında yetkilidir (ADR-05). Bütün servisler aynı kök `.env`'i okuduğu için değişkenler servis
önekiyle ayrılır (portlarla aynı desen):

```ts
// apps/catalog-service/src/config/env.ts
const mongoSchema = mongoEnvSchemaFor({ prefix: 'CATALOG', defaultDb: 'getir_catalog' });
// CATALOG_MONGO_URI (zorunlu; kullanıcı ve parolayı taşır), CATALOG_MONGO_DB (varsayılanı
// getir_catalog), MONGO_SERVER_SELECTION_TIMEOUT_MS ve MONGO_OPERATION_TIMEOUT_MS (ortak)
//   -> { uri, dbName, serverSelectionTimeoutMs, operationTimeoutMs }
```

Eksik değişkenin **adı** hatada görünür (`CATALOG_MONGO_URI: ...`). D14 öncesi ortak `MONGO_URI` ve
`MONGO_DB` okunmaz: servis başka bir kullanıcıyla ya da ortak veritabanına sessizce bağlanmaz.
Bağlantı adresi günlüğe parolası maskelenerek yazılır (`redactConnectionString`).

## Bağlantı ve transaction

```ts
const mongo = await connectMongo({ ...env.mongo, appName: SERVICE_NAME, logger });

await mongo.withTransaction(async (session) => {
  await orders.insertOne(order, { session });
  await outbox.insertOne(event, { session }); // ikisi ya birlikte ya hiç (ADR-04)
});
```

Mongo tek düğümlü **replica set** (rs0) olarak çalışır; çok belgeli transaction'ın şartı
budur. Transaction ayarları tek yerde sabitlenmiştir: `readConcern: snapshot`,
`writeConcern: majority`, `readPreference: primary`.

**Eş zamanlı yazım yeniden denenir (T7.3'te bulundu).** İki transaction aynı belgeye yazınca
kaybeden `WriteConflict` (112, `TransientTransactionError` etiketli) alır ve sürücü transaction'ı
baştan tekrar dener. `MongoRepository.run()` her sürücü hatasını `AppError`'a çevirdiği için bu
etiket kayboluyordu: sürücü tekrar denemiyor, çağıran `INTERNAL` alıyordu. `withTransaction`
artık etiketli asıl hatayı (`AppError.cause`) sürücüye geri verir (`retryableTransactionCause`);
tekrar denemede geri çağrı güncel veriyi görür (örneğin sürüm koşulu tutmaz → `CONFLICT`).
Deneme süresi dolarsa (işlem süresi varsa o süre, yoksa 120 sn) `SERVICE_UNAVAILABLE` olur. Geri çağrı bu yüzden
**tekrar çalıştırılabilir** yazılmalıdır (transaction'ın içinde yan etkisiz).

**Sınırlı yeniden deneme (roadmap P3, T10.2).** Sıcak bir kayda eşzamanlı yazımda sürücünün
kendi denemesi süre dolana kadar sürer (işlem süresi yoksa 120 sn). P3'ün kuralı "en çok 3 deneme,
jitter'lı üstel bekleme"dir; bunu isteyen çağıran sürücünün denemesini kapatır ve yardımcıyı kullanır:

```ts
await retryOnConflict(
  () => mongo.withTransaction(work, { retryTransientErrors: false }), // kaybeden hemen CONFLICT alır
); // 50, 100, 200 ms (±%50) bekleyerek en çok 3 kez daha; sonra son CONFLICT
```

Yardımcı karar vermez: yalnızca `CONFLICT`'i yeniden dener, diğer hata hemen geçer; denemeler
bitince ne yapılacağı (telafi) çağıranın işidir. İş her denemede baştan çalışır, bu yüzden
güncel veriyi yeniden okumalı ve yan etkisiz olmalıdır. İlk kullanan stok onayı (T10.2).

## İşlem süresi (#51)

Mongo cevap vermeden donarsa (`docker pause`, ağ bölünmesi, kilitlenen disk) çağrı eskiden çağıranın
süresi dolana kadar asılı kalıyordu; çağıranı olmayan işçiler (outbox, tüketici, süpürücü) Mongo
dönene kadar bekliyordu. Artık her işlemin bir üst süresi var:

```ts
const mongo = await connectMongo({ ...env.mongo, appName: SERVICE_NAME, logger });
// env.mongo.operationTimeoutMs = MONGO_OPERATION_TIMEOUT_MS (varsayılan 2000, 100-60000)
```

- **Nasıl:** sürücünün kendi işlem süresi (`timeoutMS`, CSOT). Süre **veritabanı tutamağına**
  (`mongo.db`) ve transaction'a verilir; istemcinin kendisine değil. Tutamaktan açılan her koleksiyon
  süreyi miras alır. Süre bir işlemin tamamını kapsar: sunucu seçimi, havuzdan bağlantı, el sıkışma,
  cevap ve sürücünün yeniden denemeleri. Süre dolunca bağlantı kapatılır, havuz tükenmez.
- **Ne döner:** `SERVICE_UNAVAILABLE` "Veritabani zamaninda cevap vermedi" (gateway'de 503).
- **Ne kadar sürer** (donmuş Mongo'da ölçüldü): tekil işlem **1 süre** (2 sn), transaction **2 süre**
  (4 sn). Transaction süresi dolunca sürücü geri alma gönderir ve geri alma için süreyi baştan
  başlatır. Sıcak kayıtta eşzamanlı yazım eskiden 120 sn deneniyordu; artık en geç 1 sürede biter.
  Sürücü denemeler arasında 5-500 ms bekler ve bir sonraki bekleme süreyi aşacaksa erken bırakır.
- **Sağlık:** `mongo.ping()` de süreli; donmuş Mongo'da sağlık yoklaması `false` döner, asılı kalmaz.
- **Süresiz kalanlar:** açılıştaki ve `pnpm migrate`'teki göçler (çalıştırıcı `mongo.unbounded`'ı
  kullanır: aynı havuzun süresiz görünümü), indeks kurulumu (`ensureIndexes`, işlem başına
  `timeoutMS: 0`), `pnpm seed` ve inventory `reseed` (`withoutOperationTimeout(env.mongo)`). Uzun bir
  göç ya da toplu yazım yarıda kesilmez.
- **İşlem kendi seçeneğinde süre taşımaz:** sürücü, süreli transaction'ın içinde işleme verilen
  `timeoutMS`'i reddeder (miras alınanı değil). Süre yalnızca bağlantı ayarından gelir.
- **Toplu yazım `bulkCollection()` ile (sürücü hatası, 7.6 ve 7.7):** `insertMany` ve `bulkWrite`
  seçeneklerini iki kez çözer. İkinci çözümde tutamaktan miras alınan süreyi "işleme verilmiş"
  sayar ve süreli transaction'ın içinde reddeder ("An operation cannot be given a timeoutMS
  setting"). Sonuç: sipariş + outbox yazımı `INTERNAL` düşerdi; `pnpm test:int` yakaladı. Repository
  toplu yazımı `this.bulkCollection(options)` ile yapar: oturum varsa süre miras almayan tutamak
  (işlemi transaction'ın süresi sınırlar), yoksa süreli tutamak. ESLint kuralı
  (`getir/mongo-bulk-writes`) `this.collection.insertMany` / `bulkWrite`'ı yasaklar. Diğer işlemler
  (insertOne, update*, replace, delete*, find*, aggregate, count, distinct, findOneAnd*) etkilenmez;
  süreli transaction içinde tek tek denendi. Kanarya testi sürücü düzelince kırmızı olur; o zaman
  yardımcı ve kural kaldırılır.

**Zaman aşımı "yazılmadı" demek değildir.** Mongo donmuşken gönderilen tekil yazım yolda bekler;
Mongo çözülünce uygulanabilir (`operation-timeout.spec.ts` bunu sabitler). Ağ hatasında da durum
aynıdır. Çağıran yeniden denerken yazımın tekrar güvenli olmasına güvenir: benzersiz indeks,
idempotency anahtarı ya da sürüm koşulu. Transaction'da commit gönderilmeden kesilen iş ise geri
alınır, yarım kalmaz.

**Tüketicide (event-bus):** işleyicinin Mongo çağrısı süre dolunca hata olur ve teslim başarısız
sayılır: en az 30 sn arayla (`claimIdleMs`) en çok 5 teslim, sonra ölü olay (`stream:events:dead`). Eskiden işleyici
takılıyor, grubun işi duruyordu. Mongo yaklaşık 2 dakikadan uzun donarsa olaylar ölü akıştan elle
yeniden oynatılır (event-bus README).

**Sınır:** süre isteğin gRPC'de kalan süresinden bağımsızdır (ortak sabit). order → risk (1 sn) gibi
daha kısa çağrılarda çağıran önce vazgeçer; servisteki iş yine en geç süre sonunda biter.

## Repository tabanı

```ts
class ProductRepository extends MongoRepository<ProductDoc> {
  constructor(db: Db) {
    super(db, 'products');
  }

  protected override indexes(): readonly IndexDescription[] {
    return [{ key: { sku: 1 }, unique: true, name: 'sku_unique' }];
  }

  // Karmaşık sorgu alt sınıfın kendi metodu olur, taban sınıfa eklenmez.
  async search(term: string) {
    return this.collection.find({ $text: { $search: term } }).toArray();
  }
}
```

Taban sınıf `findById`, `findOne`, `insertOne`, `updateById`, `deleteById`, `count`,
`exists` ve `ensureIndexes` verir; hepsi hata çeviricisinden geçer ve isteğe bağlı
`{ session }` alır. **Her şeyi sarmalamaz**: aggregate, 2dsphere ve toplu yazım
doğrudan `this.collection` üzerinden yazılır — sarmalayıcı arkasına saklanan bir sorgu
hata ayıklamayı zorlaştırır.

İndeksler koda **bildirilir**, elle `mongosh` ile açılmaz: hangi sorgunun hangi indekse
dayandığı sorgunun yanındaki dosyada görünür. `_id` string'dir (`ord_...`, `prd_...`),
ObjectId değil — kimliğin türü log satırında ve Redis anahtarında çıplak gözle okunsun diye.

## Göçler (T10.4, ADR-19)

Şema ve veri değişikliği elle yapılmaz; sürümlü ve geri alınabilir göçle yapılır. Çalıştırıcı
burada, göçler sahibi servisin kodunda (`apps/<servis>/src/migrations/`):

```ts
// apps/catalog-service/src/migrations/0001-arama-terimlerini-katla.ts
export const foldSearchTerms: Migration = {
  version: 1,
  name: 'arama-terimlerini-katla',
  up: (context) => ..., // context.db, context.session (transaction), context.logger
  down: (context) => ...,
};
// apps/catalog-service/src/migrations/index.ts
export const MIGRATIONS: readonly Migration[] = [foldSearchTerms];
```

- **Açılışta:** servis bağlanınca `applyMigrations(connection, MIGRATIONS, logger)` bekleyenleri
  **indekslerden önce** uygular. Bekleyen yoksa kilit alınmaz (her açılışta yazım olmaz).
- **Kayıt:** servisin kendi veritabanında `migrations` (`_id` = sürüm, ad, an, süre). Aynı göç iki
  kez kaydedilemez.
- **Kilit:** `migrations_lock` tek belge (sahip + bitiş anı, 10 dk). İki örnek aynı anda açılırsa
  göç bir kez koşar; ikincisi bekler, sonra hepsini uygulanmış bulur. Çöken çalıştırmanın kilidi
  ömrü dolunca devralınır; çalışan sahip her göç öncesi ömrü yeniler.
- **Transaction:** varsayılan olarak göç ve kaydı tek transaction'da (ya ikisi ya hiçbiri).
  Transaction'da yapılamayan iş için `transaction: false`; o göç yeniden çalıştırılabilir yazılır.
- **Durdurur:** kayıtta olup kodda olmayan sürüm (kod geri alınmış), aynı sürüm farklı adla, en
  yeni uygulanmıştan küçük bekleyen sürüm (sıra bozuk).
- **Komut:** `pnpm --filter @getir/<servis> migrate up | down | status` (`migrateMain`); kökten
  `pnpm migrate up | status`. `down` en son tek göçü geri alır, kökten çalışmaz.
- **Kural:** göç o günün mantığının donmuş kopyasıdır (domain koduna, koleksiyon sabitine
  bağlanmaz); uygulanmış göç değiştirilmez, düzeltme yeni göçtür. İndeksler göç değildir.

## Hata çevirisi

| Mongo durumu                     | AppError              | Sonuç                                |
| -------------------------------- | --------------------- | ------------------------------------ |
| Benzersiz indeks ihlali (11000)  | `CONFLICT`            | 409 / gRPC ABORTED                   |
| Ağ / sunucu seçimi hatası        | `SERVICE_UNAVAILABLE` | 503 / gRPC UNAVAILABLE               |
| İşlem süresi doldu (#51)         | `SERVICE_UNAVAILABLE` | "Veritabani zamaninda cevap vermedi" |
| Düğüm birincil değil / kapanıyor | `SERVICE_UNAVAILABLE` | "Veritabani su an hizmet vermiyor"   |
| Yetkisiz erişim (13, D14)        | `INTERNAL`            | "Veritabani yetkisi yok"             |
| Diğer                            | `INTERNAL`            | 500, özgün mesaj dışarı çıkmaz       |

**Kimlik doğrulama (D14).** Yanlış kullanıcı ya da parolada (`AuthenticationFailed`, 18)
`connectMongo` "tekrar denenebilir" `SERVICE_UNAVAILABLE` yerine `INTERNAL` ve
"Mongo kimlik dogrulamasi reddedildi" der: beklemek düzeltmez, sebebi ağ sorunu sanılmasın.
Mesajdaki adresin parolası maskelidir. Servis başka servisin veritabanına erişmeye kalkarsa Mongo
reddeder (`Unauthorized`, 13); hata adıyla `INTERNAL` olur.

**Birincil yok (#51).** Düğüm yazım kabul etmiyorsa (`not primary` ve ailesi: 10107, 13435, 13436,
10058, 189; kapanış: 11600, 11602, 91) hata geçicidir, beklemekle düzelir. Eskiden `INTERNAL`
dönüyordu: yeni hacimde replica set henüz kurulmadan çalışan seed `not primary` ile düşmüştü
(`pnpm infra:up` artık sağlık yoklamasını bekler: `--wait`).

Çakışan **değer** dışarı verilmez, yalnızca alan adı: `keyValue` müşteri verisi
taşıyabilir (telefon, adres) ve hata zarfı istemciye gider.

**Toplu yazım** (`bulkWrite`, `insertMany`) yazım dışı bir hatayı (ağ, sunucu seçimi)
`MongoBulkWriteError`'a sarar; asıl hata `errorResponse`'tadır ve o çevrilir. Tanınmasaydı Mongo
kapalıyken her toplu yazım tekrar denenebilir `SERVICE_UNAVAILABLE` yerine `INTERNAL` dönerdi
(T10.2 canlı testinde bulundu). Toplu yazımdaki benzersiz indeks ihlali yine `CONFLICT`'tir.

## Test

`test/integration` gerçek Mongo ile koşar (Testcontainers, tek düğümlü replica set):
benzersiz indeksin gerçekten ihlal edilmesi ve transaction'ın gerçekten geri alınması
sahte istemciyle doğrulanamaz. `auth.spec.ts` kimlik doğrulamalı replica set'te (yerel compose
ile aynı kurulum) servis kullanıcısının kendi veritabanında çalıştığını, başka veritabanında
reddedildiğini ve yanlış parolanın mesajını sınar. `migration.spec.ts` göç çalıştırıcısını sınar:
sıra, transaction, up → down → up, aynı anda iki çalıştırıcı, kilit devri, tutarsızlık.
`operation-timeout.spec.ts` (#51) Mongo'nun önüne dondurulabilen bir TCP vekili koyar
(`test/support/freezing-proxy.ts`, `docker pause` gibi: bağlantı açık, cevap yok). Sınadıkları:

- süresiz bağlantı donukken cevap alamaz (kontrol deneyi), süreli olan sürede döner;
- havuz tükenmez;
- transaction iki sürede döner ve yarım kalmaz;
- çözülünce bağlantı toparlanır;
- tekil yazım çözülünce uygulanabilir;
- ping süreli;
- sıcak kayıt 120 sn değil, süre içinde biter;
- indeks kurulumu ve göçler süresizdir.

`pnpm test:int`.
