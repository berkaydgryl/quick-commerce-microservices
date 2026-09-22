# @getir/catalog-service

Katalog verisinin **tek sahibi** (ADR-05): kategoriler, ürünler ve dark store'lar. Başka
hiçbir servis bu veriye doğrudan erişmez; yalnızca `getir.catalog.v1.CatalogService`
RPC'leri üzerinden okur.

Bu serviste **olmayanlar**, bilinçli: stok/müsaitlik `inventory-service`'in (B27), kampanyalı
fiyat ve kupon `pricing`'in işidir. `Product` mesajında stok alanı yoktur.

## Bugünkü durum (T3.1)

| RPC                | Durum                                                 |
| ------------------ | ----------------------------------------------------- |
| `ListCategories`   | ✅ Sahte veriyle çalışıyor                            |
| `ListProducts`     | ✅ Filtre (kategori, depo, arama) + imleçli sayfalama |
| `GetProduct`       | ⏳ `UNIMPLEMENTED` — T4                               |
| `BatchGetProducts` | ⏳ `UNIMPLEMENTED` — T4                               |
| `ResolveDarkStore` | ⏳ `UNIMPLEMENTED` — T4.2                             |

Veri kaynağı bugün **bellekte** (`src/infrastructure/fixtures.ts`): 5 kategori, 15 ürün,
2 dark store. T4.1'de Mongo repository'si gelecek; `CatalogRepository` arayüzü aynı kaldığı
için use-case'ler değişmeyecek.

Yazılmamış RPC'ler boş bırakılmadı, açıkça `UNIMPLEMENTED` dönüyor. Sebep: grpc-js, tanımda
olup uygulamada olmayan her metot için açılışta hata seviyesinde günlük yazar — her açılışta
"bir şey bozuk" izlenimi verirdi. Bu bir `AppError` de değil: "bu uç henüz yok" iş hatası
değil, protokol gerçeğidir.

## Katmanlar

```text
src/
├── domain/            # saf iş kuralı — mongodb/grpc/proto importu YOK
│   ├── catalog.ts            # Category, Product, DarkStore + sıralama/arama kuralları
│   ├── pagination.ts         # sayfa boyutu sınırları + imleçle dilimleme
│   └── catalog-repository.ts # port (arayüz)
├── application/       # bir dosya = bir use-case
│   ├── list-categories.ts
│   └── list-products.ts
├── infrastructure/    # portun uygulaması
│   ├── fixtures.ts
│   └── in-memory-catalog-repository.ts
├── interfaces/grpc/   # ince handler'lar: doğrula → çağır → çevir
│   ├── schemas.ts     # Zod istek şemaları
│   ├── mappers.ts     # domain → proto
│   └── catalog-handlers.ts
├── config/            # env.ts (process.env yalnızca burada) + constants.ts
├── bootstrap.ts       # elle bağımlılık kurulumu
├── main.ts            # süreç yaşam döngüsü
└── healthcheck.ts     # Docker HEALTHCHECK için grpc.health.v1 sorgusu
```

Ok hiçbir zaman yukarı gitmez: `infrastructure/`, `application/`'ı çağıramaz.

## İki karar

**Sayfalama imleci offset değil, "son görülen kimlik".** Katalog sıralaması stok, kampanya
ve popülerlikle değişir; offset ile ikinci sayfa istendiğinde liste kaymış olabilir ve aynı
ürün iki kez görünür ya da hiç görünmez. Kayıtlar kimliğe göre sıralı olduğu için sonraki
sayfa "kimliği bundan büyük olanlar" ile deterministik bulunur — T4.1'de Mongo'da
`{ _id: { $gt: token } }` sorgusuna birebir çevrilir.

**Boş metin = filtre yok.** proto3'te set edilmemiş string alan çözüldüğünde `''` olur;
"gönderilmedi" ile "boş gönderildi" ayırt edilemez. Şema bu boşlukları `undefined`'a çevirir,
use-case yalnızca gerçek filtreleri görür.

## Çalıştırma ve doğrulama

```bash
pnpm --filter @getir/catalog-service build
pnpm --filter @getir/catalog-service start      # 50051 portunda dinler
```

```bash
grpcurl -plaintext -import-path packages/proto/proto -proto getir/catalog/v1/catalog.proto \
  localhost:50051 getir.catalog.v1.CatalogService/ListCategories

grpcurl -plaintext -import-path packages/proto/proto -proto getir/catalog/v1/catalog.proto \
  -d '{"category_id":"cat_2","page":{"page_size":2}}' \
  localhost:50051 getir.catalog.v1.CatalogService/ListProducts

grpcurl -plaintext -proto packages/service-kit/proto/health.proto \
  -d '{"service":"getir.catalog.v1.CatalogService"}' localhost:50051 grpc.health.v1.Health/Check
```

Aynı akışın otomatik karşılığı `test/unit/catalog-grpc.spec.ts`: gerçek sunucu, gerçek
istemci, dış bağımlılık yok.

## Docker

```bash
docker build -f apps/catalog-service/Dockerfile -t getir/catalog-service .
docker run --rm -p 50051:50051 getir/catalog-service
```

Build bağlamı **depo köküdür**, app klasörü değil: servis `@getir/core`, `@getir/proto` ve
`@getir/service-kit` paketlerine `workspace:*` ile bağlı. İmaj çok aşamalıdır (derleme
araçları çalışma zamanına sızmaz), `node` kullanıcısıyla çalışır ve `HEALTHCHECK` servisin
kendi `grpc.health.v1` ucunu sorar — konteynerde HTTP yok, `curl` ile kontrol edilemez.
