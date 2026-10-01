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
// getir_catalog), MONGO_SERVER_SELECTION_TIMEOUT_MS (ortak) -> { uri, dbName, serverSelectionTimeoutMs }
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
Deneme süresi dolarsa `WriteConflict` yine `CONFLICT` olarak döner. Geri çağrı bu yüzden
**tekrar çalıştırılabilir** yazılmalıdır (transaction'ın içinde yan etkisiz).

**Sınırlı yeniden deneme (roadmap P3, T10.2).** Sıcak bir kayda eşzamanlı yazımda sürücünün
kendi denemesi beklemesizdir ve süre dolana kadar (120 sn) sürer. P3'ün kuralı "en çok 3 deneme,
jitter'lı üstel bekleme"dir; bunu isteyen çağıran sürücünün denemesini kapatır ve yardımcıyı kullanır:

```ts
await retryOnConflict(
  () => mongo.withTransaction(work, { retryTransientErrors: false }), // kaybeden hemen CONFLICT alır
); // 50, 100, 200 ms (±%50) bekleyerek en çok 3 kez daha; sonra son CONFLICT
```

Yardımcı karar vermez: yalnızca `CONFLICT`'i yeniden dener, diğer hata hemen geçer; denemeler
bitince ne yapılacağı (telafi) çağıranın işidir. İş her denemede baştan çalışır, bu yüzden
güncel veriyi yeniden okumalı ve yan etkisiz olmalıdır. İlk kullanan stok onayı (T10.2).

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

## Hata çevirisi

| Mongo durumu                    | AppError              | Sonuç                          |
| ------------------------------- | --------------------- | ------------------------------ |
| Benzersiz indeks ihlali (11000) | `CONFLICT`            | 409 / gRPC ABORTED             |
| Ağ / sunucu seçimi hatası       | `SERVICE_UNAVAILABLE` | 503 / gRPC UNAVAILABLE         |
| Yetkisiz erişim (13, D14)       | `INTERNAL`            | "Veritabani yetkisi yok"       |
| Diğer                           | `INTERNAL`            | 500, özgün mesaj dışarı çıkmaz |

**Kimlik doğrulama (D14).** Yanlış kullanıcı ya da parolada (`AuthenticationFailed`, 18)
`connectMongo` "tekrar denenebilir" `SERVICE_UNAVAILABLE` yerine `INTERNAL` ve
"Mongo kimlik dogrulamasi reddedildi" der: beklemek düzeltmez, sebebi ağ sorunu sanılmasın.
Mesajdaki adresin parolası maskelidir. Servis başka servisin veritabanına erişmeye kalkarsa Mongo
reddeder (`Unauthorized`, 13); hata adıyla `INTERNAL` olur.

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
reddedildiğini ve yanlış parolanın mesajını sınar. `pnpm test:int`.
