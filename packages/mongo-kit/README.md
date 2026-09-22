# @getir/mongo-kit

MongoDB'ye bakan üç şey burada: **bağlantı**, **repository tabanı** ve **hata çevirisi**.
Hangi koleksiyonun hangi alanları taşıdığı bu pakette yazmaz — o, sahibi servisin işidir
(ADR-05).

## Bağlantı ve transaction

```ts
const mongo = await connectMongo({ uri: env.MONGO_URI, dbName: env.MONGO_DB, logger });

await mongo.withTransaction(async (session) => {
  await orders.insertOne(order, { session });
  await outbox.insertOne(event, { session }); // ikisi ya birlikte ya hiç (ADR-04)
});
```

Mongo tek düğümlü **replica set** (rs0) olarak çalışır; çok belgeli transaction'ın şartı
budur. Transaction ayarları tek yerde sabitlenmiştir: `readConcern: snapshot`,
`writeConcern: majority`, `readPreference: primary`.

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
| Diğer                           | `INTERNAL`            | 500, özgün mesaj dışarı çıkmaz |

Çakışan **değer** dışarı verilmez, yalnızca alan adı: `keyValue` müşteri verisi
taşıyabilir (telefon, adres) ve hata zarfı istemciye gider.

## Test

`test/integration` gerçek Mongo ile koşar (Testcontainers, tek düğümlü replica set):
benzersiz indeksin gerçekten ihlal edilmesi ve transaction'ın gerçekten geri alınması
sahte istemciyle doğrulanamaz. `pnpm test:int`.
