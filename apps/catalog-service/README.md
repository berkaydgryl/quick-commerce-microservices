# @getir/catalog-service

Katalog verisinin **tek sahibi** (ADR-05): kategoriler, ürünler ve dark store'lar. Başka
hiçbir servis bu veriye doğrudan erişmez; yalnızca `getir.catalog.v1.CatalogService`
RPC'leri üzerinden okur.

Bu serviste **olmayanlar**, bilinçli: stok/müsaitlik `inventory-service`'in (B27), kampanyalı
fiyat ve kupon `pricing`'in işidir. `Product` mesajında stok alanı yoktur.

## Bugünkü durum (T4.1)

| RPC                | Durum                                                 |
| ------------------ | ----------------------------------------------------- |
| `ListCategories`   | ✅ Mongo ya da `MOCK` (bellek)                        |
| `ListProducts`     | ✅ Filtre (kategori, depo, arama) + imleçli sayfalama |
| `GetProduct`       | ⏳ `UNIMPLEMENTED` — T4                               |
| `BatchGetProducts` | ⏳ `UNIMPLEMENTED` — T4                               |
| `ResolveDarkStore` | ⏳ `UNIMPLEMENTED` — T4.2                             |

## Veri kaynağı: Mongo ya da MOCK

| `MOCK` | Kaynak                                                  | Mongo gerekir mi          |
| ------ | ------------------------------------------------------- | ------------------------- |
| `true` | `InMemoryCatalogRepository` (bellek)                    | Hayır                     |
| değil  | `MongoCatalog` (`categories`, `products`, `darkstores`) | Evet, `MONGO_URI` zorunlu |

İki kaynak da **aynı demo verisinden** beslenir (`src/infrastructure/fixtures.ts`: 5 kategori,
15 ürün, 2 dark store) ve **aynı sözleşme testinden** geçer
(`test/support/catalog-repository-contract.ts`): birim testinde bellek, entegrasyon testinde
gerçek Mongo. MOCK modunda çalışan frontend gerçek modda da aynı cevabı görür.

Mongo'yu doldurmak: `pnpm seed` (kök). Üç koleksiyon **tek transaction**'da silinip yeniden
yazılır; tekrar koşmak güvenlidir, yarıda kalan seed hiçbir koleksiyonu değiştirmez.
`NODE_ENV=production` iken reddeder — Docker imajı production olduğu için konteynerde seed
bilinçli olarak `NODE_ENV=development` verilmeden çalışmaz.

### Belge şekli ve indeksler

| Koleksiyon   | Domain'de olmayan alan                    | İndeks                                                 |
| ------------ | ----------------------------------------- | ------------------------------------------------------ |
| `categories` | —                                         | `slug` unique                                          |
| `products`   | `darkStoreIds[]` (çeşit), `searchTerms[]` | `sku` unique, `{categoryId,_id}`, `{darkStoreIds,_id}` |
| `darkstores` | `location` GeoJSON `[boylam, enlem]`      | `location` 2dsphere (T4.2 `ResolveDarkStore`)          |

- **`darkStoreIds`:** "bu depo bu ürünü satıyor mu" bilgisi (stok değil, B27). Depo filtresi
  tek sorguda çözülür.
- **`searchTerms`:** ad ve açıklamanın Türkçe küçük harfli hali. Mongo'nun regex `i` bayrağı
  `İ → i` eşlemesini bilmez; normalizasyon yazım anında `domain/searchKey` ile yapılır, bellek
  uygulamasıyla aynı fonksiyon.
- İndeksler sorgulara göre seçildi: filtre + imleç sıralaması (`_id`) tek indeksten okunur.
  Metin araması (başı açık regex) indeks kullanamaz; katalog küçük olduğu için kabul edildi.
- **Görseller göreli yol** (`/img/cat/sut.png`): mutlak URL'yi gateway (BFF) `ASSET_BASE_URL`
  ile kurar. Veriye alan adı yazılmaz.

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
│   ├── catalog-repository.ts # okuma portu
│   └── catalog-snapshot.ts   # seed portu + katalogun tamamı
├── application/       # bir dosya = bir use-case
│   ├── list-categories.ts
│   ├── list-products.ts
│   └── seed-catalog.ts
├── infrastructure/    # portların uygulaması
│   ├── fixtures.ts                      # demo verisi (MOCK + seed tek kaynak)
│   ├── in-memory-catalog-repository.ts  # MOCK
│   └── mongo/                           # belgeler, çeviriciler, koleksiyon başına repository
├── interfaces/grpc/   # ince handler'lar: doğrula → çağır → çevir
│   ├── schemas.ts     # Zod istek şemaları
│   ├── mappers.ts     # domain → proto
│   └── catalog-handlers.ts
├── config/            # env.ts (process.env yalnızca burada) + constants.ts
├── bootstrap.ts       # elle bağımlılık kurulumu
├── main.ts            # süreç yaşam döngüsü
├── seed.ts            # pnpm seed giriş noktası
└── healthcheck.ts     # Docker HEALTHCHECK için grpc.health.v1 sorgusu
```

Ok hiçbir zaman yukarı gitmez: `infrastructure/`, `application/`'ı çağıramaz.

## İki karar

**Sayfalama imleci offset değil, "son görülen kimlik".** Katalog sıralaması stok, kampanya
ve popülerlikle değişir; offset ile ikinci sayfa istendiğinde liste kaymış olabilir ve aynı
ürün iki kez görünür ya da hiç görünmez. Kayıtlar kimliğe göre sıralı olduğu için sonraki
sayfa "kimliği bundan büyük olanlar" ile deterministik bulunur — Mongo'da
`{ _id: { $gt: token } }` sorgusuna birebir çevrilir.

**Boş metin = filtre yok.** proto3'te set edilmemiş string alan çözüldüğünde `''` olur;
"gönderilmedi" ile "boş gönderildi" ayırt edilemez. Şema bu boşlukları `undefined`'a çevirir,
use-case yalnızca gerçek filtreleri görür.

## Çalıştırma ve doğrulama

```bash
pnpm --filter @getir/catalog-service build
MOCK=true pnpm --filter @getir/catalog-service start   # 50051, Mongo'suz

pnpm infra:up && pnpm seed                             # ya da Mongo ile:
MONGO_URI="mongodb://localhost:27017/getir?directConnection=true" \
  pnpm --filter @getir/catalog-service start
```

`start`, `dev` ve `seed` kök `.env`'yi okur (`--env-file-if-exists`); dosya yoksa ortam
değişkenleri geçerlidir.

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
docker run --rm -p 50051:50051 -e MOCK=true getir/catalog-service
```

Build bağlamı **depo köküdür**, app klasörü değil: servis `@getir/core`, `@getir/proto` ve
`@getir/service-kit` paketlerine `workspace:*` ile bağlı. İmaj çok aşamalıdır (derleme
araçları çalışma zamanına sızmaz), `node` kullanıcısıyla çalışır ve `HEALTHCHECK` servisin
kendi `grpc.health.v1` ucunu sorar — konteynerde HTTP yok, `curl` ile kontrol edilemez.

Testler: `pnpm test:unit` (bellek, sözleşme, seed kapısı, çeviriciler) ve `pnpm test:int`
(gerçek Mongo: sözleşme, seed sayıları ve tekrarı, indeksler, transaction geri alma, 3 demo
adresinin 2dsphere'e karşı doğru depoya düşmesi).
