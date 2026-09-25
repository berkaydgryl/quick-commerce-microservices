# @getir/catalog-service

Pazaryeri katalogunun **tek sahibi** (ADR-05, ADR-15): marketler, ortak ürünler, teklifler
(market × ürün → fiyat) ve kategoriler. Başka hiçbir servis bu veriye doğrudan erişmez;
yalnızca `getir.catalog.v1.CatalogService` RPC'leri üzerinden okur.

Bu serviste **olmayanlar**, bilinçli: stok/müsaitlik `inventory-service`'in (B27), sepet
hesabı ve kupon `packages/pricing`'in işidir. Teklifte stok alanı yoktur.

## İş modeli: pazaryeri (ADR-15)

Kullanıcı konumuna hizmet veren marketleri görür ve **birini seçer**; sistem market atamaz.
Ürün kataloğu ortaktır ve **fiyat taşımaz**; bir marketin o ürünü hangi fiyatla sattığı
**tekliftir**. Aynı süt Migros Jet – Moda'da 34,90 TL, A101 – Caferağa'da 32,10 TL'dir. Her
market kendi kurallarını taşır: minimum sepet, teslimat ücreti, ücretsiz teslimat eşiği,
teslimat süresi ve puan. Market paneli kapsam dışıdır; değerler seed'dendir.

## Bugünkü durum (T9.3 — T7.2 öncesi öne alındı)

| RPC                    | Durum                                                                                                                                             |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ListCategories`       | ✅ Platform kategorileri                                                                                                                          |
| `ListNearbyMarkets`    | ✅ Konumu kapsayan marketler, yakından uzağa; kapalılar dahil; boşsa boş                                                                          |
| `GetMarket`            | ✅ Puan, süre, fiyat kuralları; yoksa `NOT_FOUND`                                                                                                 |
| `ListMarketCategories` | ✅ Marketin aktif teklifi olan kategoriler (manav yalnızca meyve-sebze)                                                                           |
| `ListProducts`         | ✅ `market_id` zorunlu; teklifler o marketin fiyatıyla, kategori + arama + imleç                                                                  |
| `ResolveDarkStore`     | ⛔ Deprecated (ADR-15): `UNIMPLEMENTED`, mesaj `ListNearbyMarkets`'i gösterir                                                                     |
| `GetProduct`           | ⏳ `UNIMPLEMENTED` — T8.4                                                                                                                         |
| `BatchGetOffers`       | ✅ Marketin satılabilir teklifleri, **tek sorguda** (en fazla 100 kimlik); pasif / başka marketin / olmayan → `missing`; market yoksa `NOT_FOUND` |
| `BatchGetProducts`     | ⛔ `UNIMPLEMENTED` — kullanan yok; fiyat teklife ait olduğu için sepet doğrulaması `BatchGetOffers` ile                                           |

T4.2'nin "yarıçap içinde ama kapalı → `STORE_CLOSED`, yarıçap dışı → `OUT_OF_RANGE`" kuralı
kaybolmadı: tek market için `domain/market-coverage.ts` → `evaluateCoverage`'da duruyor ve
rezervasyon (T11.4) seçilen marketin hâlâ hizmet verip vermediğini buna soracak.

## BatchGetOffers (T9.3)

Sipariş fiyat doğrulamasının (T7.2) kaynağı: sepetteki her kalemin **o marketteki** fiyatı tek çağrıda.

| Durum                                                                          | Sonuç                                                                     |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------------------- |
| Aktif teklif                                                                   | `offers` (istek sırasında)                                                |
| Pasif teklif (market satıştan kaldırmış), başka marketin ürünü, olmayan kimlik | `missing` — sessizce atlanmaz                                             |
| Aynı kimlik iki kez                                                            | Tek sayılır                                                               |
| Bilinmeyen market                                                              | `NOT_FOUND`                                                               |
| 100'den fazla kimlik ya da boş kimlik                                          | `VALIDATION_FAILED`                                                       |
| Biçimi bozuk ama dolu kimlik                                                   | Reddedilmez, `missing`'e düşer (tek hatalı kalem bütün sepeti düşürmesin) |

- **"Satılır mı" kararı use-case'te** (`application/batch-get-offers.ts`); depo pasifler dahil ham teklifleri
  döner, iş kararı vermez.
- **Tek sorgu:** `{ marketId, productId: $in }` → `market_product_unique` indeksi. Filtre
  `offersByProductIdsFilter`'da; depo ve sorgu planı testi aynı fonksiyonu kullanır, test yalnızca
  **kazanan** planı okur.
- **Ölçüt testleri:** 50 kalemlik sepet tek çağrıda (gRPC, şemadan geçerek); use-case'te okuyucuya tam bir
  çağrı; tam 100 kimlik geçer, 101 reddedilir.

## Veri kaynağı: Mongo ya da MOCK

| `MOCK` | Kaynak                                                                | Mongo gerekir mi          |
| ------ | --------------------------------------------------------------------- | ------------------------- |
| `true` | Bellek okuyucuları (`infrastructure/memory`)                          | Hayır                     |
| değil  | Mongo repository'leri (`markets`, `offers`, `products`, `categories`) | Evet, `MONGO_URI` zorunlu |

İki kaynak da **aynı demo verisinden** beslenir (`src/infrastructure/fixtures/`: 5 kategori,
15 ortak ürün, 6 market, 71 teklif) ve **aynı sözleşme testlerinden** geçer
(`test/support/{category,market,offer}-reader-contract.ts`): birim testinde bellek, entegrasyon
testinde gerçek Mongo. Veri kaynağını seçip açan tek yer `infrastructure/catalog-source.ts`'tir.

### Üç port, her use-case yalnızca ihtiyacını alır

| Port             | Metotlar                                                            | Kullanan use-case                                        |
| ---------------- | ------------------------------------------------------------------- | -------------------------------------------------------- |
| `CategoryReader` | `listCategories`                                                    | `ListCategories`, `ListMarketCategories`                 |
| `MarketReader`   | `getMarket`, `marketExists`, `listMarketsByDistance`                | `ListNearbyMarkets`, `GetMarket`, varlık kontrolleri     |
| `OfferReader`    | `listOffers`, `listCategoryIdsWithOffers`, `findOffersByProductIds` | `ListProducts`, `ListMarketCategories`, `BatchGetOffers` |

### Belge şekli ve indeksler

| Koleksiyon   | Domain'de olmayan alan                                   | İndeks                                                                       |
| ------------ | -------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `categories` | —                                                        | `slug` unique                                                                |
| `products`   | — (fiyat yok)                                            | `sku` unique                                                                 |
| `markets`    | `location` GeoJSON `[boylam, enlem]`                     | `location` 2dsphere (`$geoNear`)                                             |
| `offers`     | `product` kopyası, `categoryId` kopyası, `searchTerms[]` | `{marketId,productId}` unique, `{marketId,categoryId,_id}`, `{marketId,_id}` |

- **Kopyalar:** teklif, listeleme alanlarını üründen kopyalar; market sayfası tek sorguda,
  `$lookup` ve N+1 olmadan listelenir. Kopyaları yalnızca catalog'un seeder'ı yazar.
- **`searchTerms`:** ad ve açıklamanın Türkçe küçük harfli hali. Mongo'nun regex `i` bayrağı
  `İ → i` eşlemesini bilmez; normalizasyon `domain/searchKey` ile, bellek uygulamasıyla aynı.
- **Kimlikler** okunabilir ve önekli (`mkt_migros-jet-moda`, `prd_sut-1l`); teklif kimliği
  market ve üründen **türetilir** (`ofr_migros-jet-moda-sut-1l`) — seed tekrarında değişmez.
- **Görseller ve logolar göreli yol**; mutlak URL'yi gateway (BFF) `ASSET_BASE_URL` ile kurar.

Mongo'yu doldurmak: `pnpm seed` (kök). Dört koleksiyon **tek transaction**'da silinip yeniden
yazılır; tekrar koşmak güvenlidir, yarıda kalan seed hiçbir koleksiyonu değiştirmez.
`NODE_ENV=production` iken reddeder.

> **Eski yerel veri:** T4.1–T4.2'de seed edilmiş bir geliştirme veritabanında `darkstores`
> koleksiyonu kalır; yeni seed onu silmez (şema değişikliği seed'in işi değil). Temizlemek için
> `pnpm infra:reset && pnpm infra:up && pnpm seed`.

## Katmanlar

```text
src/
├── domain/                # saf iş kuralı — mongodb/grpc/proto importu YOK
│   ├── catalog.ts             # Category, Product, Market, Offer + sıralama/arama/kimlik kuralları
│   ├── market-coverage.ts     # hangi market hizmet verir (kapsama, kapalı/yarıçap dışı)
│   ├── geo.ts                 # mesafe (haversine, MongoDB yarıçapı)
│   ├── pagination.ts          # sayfa boyutu sınırları + imleçle dilimleme
│   ├── category-reader.ts     # okuma portları: kategori,
│   ├── market-reader.ts       #   market,
│   ├── offer-reader.ts        #   teklif (filtre, sayfa)
│   └── catalog-snapshot.ts    # seed portu + katalogun tamamı
├── application/           # bir dosya = bir use-case
│   ├── list-categories.ts, list-nearby-markets.ts, get-market.ts
│   ├── list-market-categories.ts, list-products.ts, seed-catalog.ts
│   ├── batch-get-offers.ts       # T9.3: sepet fiyatlaması için toplu teklif okuma
├── infrastructure/
│   ├── fixtures.ts + fixtures/   # demo verisi: katalog, marketler, teklifler (MOCK + seed tek kaynak)
│   ├── catalog-source.ts         # MOCK ya da Mongo: kaynağı açar, kapanışı verir
│   ├── memory/                   # MOCK: port başına bellek okuyucusu
│   └── mongo/                    # belgeler, çeviriciler, koleksiyon başına repository, seed yazıcısı
├── interfaces/grpc/       # ince handler'lar: doğrula → çağır → çevir
├── config/                # env.ts (process.env yalnızca burada) + constants.ts
├── bootstrap.ts           # elle bağımlılık kurulumu
├── main.ts                # süreç yaşam döngüsü
├── seed.ts                # pnpm seed giriş noktası
└── healthcheck.ts         # Docker HEALTHCHECK: portu env.ts'ten alır, yoklama service-kit'te
```

## Çalıştırma ve doğrulama

```bash
pnpm --filter @getir/catalog-service build
MOCK=true pnpm --filter @getir/catalog-service start   # 50051, Mongo'suz

pnpm infra:up && pnpm seed                             # ya da Mongo ile:
MONGO_URI="mongodb://localhost:27017/getir?directConnection=true" \
  pnpm --filter @getir/catalog-service start
```

```bash
G="grpcurl -plaintext -import-path packages/proto/proto -proto getir/catalog/v1/catalog.proto"

$G -d '{"location":{"lat":40.9885,"lng":29.0262}}' \
  localhost:50051 getir.catalog.v1.CatalogService/ListNearbyMarkets     # Ev -> 3 Kadikoy marketi

$G -d '{"market_id":"mkt_a101-caferaga","query":"süt"}' \
  localhost:50051 getir.catalog.v1.CatalogService/ListProducts          # A101 fiyatlariyla

$G -d '{"market_id":"mkt_kardesler-manavi"}' \
  localhost:50051 getir.catalog.v1.CatalogService/ListMarketCategories  # yalnizca meyve-sebze
```

Aynı akışın otomatik karşılığı `test/unit/catalog-grpc.spec.ts`: gerçek sunucu, gerçek istemci,
dış bağımlılık yok.

## Docker

```bash
docker build -f apps/catalog-service/Dockerfile -t getir/catalog-service .
docker run --rm -p 50051:50051 -e MOCK=true getir/catalog-service
```

Build bağlamı **depo köküdür**. İmaj çok aşamalıdır, `node` kullanıcısıyla çalışır ve
`HEALTHCHECK` servisin kendi `grpc.health.v1` ucunu sorar.

Testler: `pnpm test:unit` (bellek, sözleşmeler, use-case'ler, veri bütünlüğü, gRPC) ve
`pnpm test:int` (gerçek Mongo: sözleşmeler, seed sayıları ve tekrarı, indeksler, transaction
geri alma, 3 demo adresinin 2dsphere'e karşı doğru marketleri listelemesi).
