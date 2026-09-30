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

## Bugünkü durum (T9.6 — genel arama)

| RPC                    | Durum                                                                                                                                             |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ListCategories`       | ✅ Platform kategorileri; sayfasız, en fazla 100 (sınırlı liste, aşağıda)                                                                         |
| `ListNearbyMarkets`    | ✅ Konumu kapsayan marketler, yakından uzağa; kapalılar dahil; boşsa boş                                                                          |
| `GetMarket`            | ✅ Puan, süre, fiyat kuralları; yoksa `NOT_FOUND`                                                                                                 |
| `ListMarketCategories` | ✅ Marketin aktif teklifi olan kategoriler (manav yalnızca meyve-sebze); sayfasız, en fazla 100                                                   |
| `ListProducts`         | ✅ `market_id` zorunlu; teklifler o marketin fiyatıyla, kategori + arama + imleç                                                                  |
| `ResolveDarkStore`     | ⛔ Deprecated (ADR-15): `NOT_IMPLEMENTED` (gRPC `UNIMPLEMENTED`, HTTP 501), mesaj `ListNearbyMarkets`'i gösterir                                  |
| `GetProduct`           | ⏳ `NOT_IMPLEMENTED` (gRPC `UNIMPLEMENTED`, HTTP 501) — T8.4                                                                                      |
| `BatchGetOffers`       | ✅ Marketin satılabilir teklifleri, **tek sorguda** (en fazla 100 kimlik); pasif / başka marketin / olmayan → `missing`; market yoksa `NOT_FOUND` |
| `SearchNearby`         | ✅ Genel arama (T9.6): konumu kapsayan marketlerde ürün ya da market adı; açıklar yakından uzağa, kapalılar sonda; market başına ilk 3 + toplam   |
| `BatchGetProducts`     | ⛔ Deprecated (proto'da işaretli): `NOT_IMPLEMENTED` — kullanan yok; fiyat teklife ait olduğu için sepet doğrulaması `BatchGetOffers` ile         |

T4.2'nin "yarıçap içinde ama kapalı → `STORE_CLOSED`, yarıçap dışı → `OUT_OF_RANGE`" kuralı
kaybolmadı: tek market için `domain/market-coverage.ts` → `evaluateCoverage`'da duruyor ve
rezervasyon (T11.4) seçilen marketin hâlâ hizmet verip vermediğini buna soracak.

## İstek doğrulaması (D6)

Gateway yalnızca **biçimi** doğrular ("sayı mı?"); kuralın kendisi burada, `interfaces/grpc/schemas.ts`'te.
Kurallar REST'in kullandığı **aynı** `@getir/contracts` şemalarıdır; burada tekrar yazılmaz.

| Alan                                         | Kural (kaynak)                                                   | İhlal                                            |
| -------------------------------------------- | ---------------------------------------------------------------- | ------------------------------------------------ |
| `market_id` (4 RPC)                          | `mkt_` + okunabilir gövde, en fazla 64 (`marketIdSchema`)        | `VALIDATION_FAILED` → 400 (404 değil)            |
| `category_id` (ListProducts)                 | Boşsa filtre yok; doluysa `cat_` biçimi (`categoryIdSchema`)     | `VALIDATION_FAILED` → 400 (boş liste değil)      |
| `query` (ListProducts)                       | Kırpıldıktan sonra 2-64 karakter (`SEARCH_QUERY_MIN/MAX_LENGTH`) | `VALIDATION_FAILED` → 400                        |
| `query` (SearchNearby)                       | **Zorunlu**; kırpıldıktan sonra 2-64 karakter (aynı sınırlar)    | Boşsa `zorunlu`, kısa/uzunsa uzunluk sebebi      |
| `location` (ListNearbyMarkets, SearchNearby) | Zorunlu; WGS84, sonlu sayı (`geoPointSchema`)                    | Türkçe sebep: `enlem -90 ile 90 arasinda olmali` |
| `product_ids` (BatchGetOffers)               | En fazla 100, boş olamaz; **biçimi bilerek esnek**               | Bozuk kimlik hata değil, `missing`               |

Boş zorunlu alan biçim hatası gibi değil `zorunlu` diye raporlanır. Sebepler `details`'te alan adıyla
döner; gateway proto adını REST adına çevirir (`query` → `q`, `location.lat` → `lat`).

## Sınırlı listeler: kategoriler sayfalanmaz

Kural "liste dönen her uç sayfalıdır" der; kategori listeleri bunun yazılı istisnasıdır
(`proje-kurallari.mdc` → "Sinirli listeler istisnasi"). Taksonomiyi seed yazar, kullanıcı üretmez:

- **Okuma sınırlı:** `CategoryReader.listCategories(limit)`; iki use-case de `MAX_CATEGORY_COUNT` (100)
  geçirir. Mongo `sort({ sortOrder: 1, _id: 1 }).limit()`, bellek aynı sırayı `firstCategories` ile keser.
- **Kesme sessiz veri kaybı olamaz:** seed 100'den fazla kategoriyi hiçbir şey yazmadan reddeder.

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

## Genel arama: SearchNearby (T9.6)

Markete girmeden arama ("Market ya da Ürün ara…"): konumu kapsayan marketlerde (`ListNearbyMarkets` ile
aynı kural, kapalılar dahil) ürün **ya da** market adı. Market içi arama (T9.5) `ListProducts`'ın `query`
alanıdır; iki arama aynı eşleşme kuralını kullanır (T9.4: harf ve Türkçe karakter duyarsız, her kelime).

| Kural                    | Davranış                                                                                                                     |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| Listelenen market        | Adı sorguyla eşleşen **ya da** en az bir aktif teklifi eşleşen; ikisi de yoksa listede yok                                   |
| Sıra                     | **Mesafe**, fiyat değil (farklı ürünlerde gramaj farkı yanıltır): açıklar önce, kapalılar sonda; her grup yakından uzağa     |
| Market başına teklif     | İlk 3 (market sayfasıyla aynı sıra) + `total_offer_matches`; istemci "+N ürün daha" ile market sayfasına aynı aramayla geçer |
| Pasif teklif             | Sayılmaz, dönmez (market sayfasında "Satışta değil" olarak görünmeye devam eder)                                             |
| Ad eşleşmesi             | "MİGROS", "migros moda", "abbasaga" → ilgili market; ürünü eşleşmese de listelenir, teklif listesi boş                       |
| Market yok / eşleşme yok | Boş liste, hata değil                                                                                                        |

- **İki sorgu, market sayısından bağımsız (N+1 yok):** `listMarketsByDistance` (en fazla
  `MARKET_CANDIDATE_LIMIT`) ve `OfferReader.searchActiveOffers`. Mongo'da ikincisi tek toplama sorgusudur:
  `$match { marketId: $in, isActive, kelimeler }` → `$sort { _id }` → `$group` (`$sum` + `$firstN`,
  Mongo 5.2+). Boru hattı `searchActiveOffersPipeline`'da; depo ve plan testi aynı fonksiyonu kullanır.
- **Yeni indeks yok:** `marketId` ile başlayan bir indeksten yalnızca kapsayan marketlerin teklifleri
  okunur. Plan testi koleksiyon taraması olmadığını ve incelenen belgenin o marketlerin teklifleriyle
  sınırlı kaldığını ölçer; üç `marketId` önekli indeksten hangisinin seçildiği planlayıcıya kalır.
- **Dahil etme ve sıralama domain'de** (`domain/nearby-search.ts`, saf). Demo verisinde kapalı market zaten
  en uzakta olduğu için "kapalılar sonda" kuralı sentetik marketlerle ayrıca sınanır.
- **Bilinen sınır:** ad ve ürün kelimeleri birleşmez; "migros süt" ne Migros'un adıyla ne bir ürünle
  eşleşir. Stok bu serviste yoktur (B27); genel aramada nasıl gösterileceği gateway işinde (T9.6 PR 2).

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

| Port             | Metotlar                                                                                  | Kullanan use-case                                                        |
| ---------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `CategoryReader` | `listCategories(limit)`                                                                   | `ListCategories`, `ListMarketCategories`                                 |
| `MarketReader`   | `getMarket`, `marketExists`, `listMarketsByDistance`                                      | `ListNearbyMarkets`, `GetMarket`, `SearchNearby`, varlık kontrolleri     |
| `OfferReader`    | `listOffers`, `listCategoryIdsWithOffers`, `findOffersByProductIds`, `searchActiveOffers` | `ListProducts`, `ListMarketCategories`, `BatchGetOffers`, `SearchNearby` |

### Belge şekli ve indeksler

| Koleksiyon   | Domain'de olmayan alan                                   | İndeks                                                                       |
| ------------ | -------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `categories` | —                                                        | `slug` unique                                                                |
| `products`   | — (fiyat yok)                                            | `sku` unique                                                                 |
| `markets`    | `location` GeoJSON `[boylam, enlem]`                     | `location` 2dsphere (`$geoNear`)                                             |
| `offers`     | `product` kopyası, `categoryId` kopyası, `searchTerms[]` | `{marketId,productId}` unique, `{marketId,categoryId,_id}`, `{marketId,_id}` |

- **Kopyalar:** teklif, listeleme alanlarını üründen kopyalar; market sayfası tek sorguda,
  `$lookup` ve N+1 olmadan listelenir. Kopyaları yalnızca catalog'un seeder'ı yazar.
- **`searchTerms`:** ad ve açıklamanın normalize hali: Türkçe küçük harf ve Türkçe karakter katlama
  (T9.4: "Süt" → `sut`, "ÇİKOLATA" → `cikolata`). Mongo'nun regex `i` bayrağı `İ → i` eşlemesini
  bilmez; normalizasyon `domain/searchKey` ile, bellek uygulamasıyla aynı. Terimleri seed yazar:
  `searchKey` değişirse `pnpm seed`; açılış eski biçimdeki terimi görürse uyarı yazar.
- **Arama (T9.4):** sorgu kelimelere ayrılır (`searchWords`), her kelime `searchTerms` içinde
  kelime içi aranır ve **hepsi** geçmeli (sıra önemsiz; biri adda, biri açıklamada olabilir).
  "sut" → Süt ve Sütlü çikolata; "peynir beyaz" → Beyaz Peynir. Kelime içi eşleşmenin sonucu:
  "kola" Çikolata'yı da bulur. Mongo metin indeksi (`$text`) bilerek kullanılmadı: yalnızca tam
  kelime eşleştirir, yazarken arama (T9.5) onunla olmaz. Sorgu market indeksinden (`market_cursor`)
  o marketin teklifleri üzerinde süzülür; entegrasyon testi planı ve incelenen belge sayısını doğrular.
- **Kimlikler** okunabilir ve önekli (`mkt_migros-jet-moda`, `prd_sut-1l`); teklif kimliği
  market ve üründen **türetilir** (`ofr_migros-jet-moda-sut-1l`) — seed tekrarında değişmez.
- **Görseller ve logolar göreli yol**; mutlak URL'yi gateway (BFF) `ASSET_BASE_URL` ile kurar.

Mongo'yu doldurmak: `pnpm seed` (kök). Dört koleksiyon **tek transaction**'da silinip yeniden
yazılır; tekrar koşmak güvenlidir, yarıda kalan seed hiçbir koleksiyonu değiştirmez.
`NODE_ENV=production` iken reddeder.

**Bütünlük kuralı domain'de:** olmayan ürüne işaret eden teklif sessizce atlanmaz. Teklifleri ürünleriyle
birleştiren tek fonksiyon `domain/catalog-snapshot.ts` → `joinOfferSeeds`; bellek okuyucusu açılışta,
Mongo seeder transaction başlamadan onu çağırır (D7'ye kadar iki adaptörde kopyaydı).

> **Eski yerel veri:** T4.1–T4.2'de seed edilmiş bir geliştirme veritabanında `darkstores`
> koleksiyonu kalır; yeni seed onu silmez (şema değişikliği seed'in işi değil). Temizlemek için
> `pnpm infra:reset && pnpm infra:up && pnpm seed`.

## Katmanlar

```text
src/
├── domain/                # saf iş kuralı — mongodb/grpc/proto importu YOK
│   ├── catalog.ts             # Category, Product, Market, Offer + sıralama/arama/kimlik kuralları
│   ├── market-coverage.ts     # hangi market hizmet verir (kapsama, kapalı/yarıçap dışı)
│   ├── nearby-search.ts       # genel arama: hangi market listelenir, hangi sırada (T9.6)
│   ├── geo.ts                 # mesafe (haversine, MongoDB yarıçapı)
│   ├── pagination.ts          # sayfa boyutu (sınırlar contracts'tan) + imleçle dilimleme
│   ├── category-reader.ts     # okuma portları: kategori,
│   ├── market-reader.ts       #   market,
│   ├── offer-reader.ts        #   teklif (filtre, sayfa)
│   └── catalog-snapshot.ts    # seed portu + katalogun tamamı + teklif-ürün birleştirme kuralı
├── application/           # bir dosya = bir use-case
│   ├── list-categories.ts, list-nearby-markets.ts, get-market.ts
│   ├── list-market-categories.ts, list-products.ts, seed-catalog.ts
│   ├── batch-get-offers.ts       # T9.3: sepet fiyatlaması için toplu teklif okuma
│   ├── search-nearby.ts          # T9.6: genel arama (markete girmeden)
├── infrastructure/
│   ├── fixtures.ts + fixtures/   # demo verisi: katalog, marketler, teklifler (MOCK + seed tek kaynak)
│   ├── catalog-source.ts         # MOCK ya da Mongo: kaynağı açar, kapanışı verir
│   ├── memory/                   # MOCK: port başına bellek okuyucusu
│   └── mongo/                    # belgeler, çeviriciler, koleksiyon başına repository, seed yazıcısı
├── interfaces/grpc/       # ince handler'lar: doğrula → çağır → çevir (mesafe yuvarlama mapper'da)
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

$G -d '{"location":{"lat":40.9885,"lng":29.0262},"query":"süt"}' \
  localhost:50051 getir.catalog.v1.CatalogService/SearchNearby          # Ev -> A101 ve Migros Moda
```

Aynı akışın otomatik karşılığı `test/unit/grpc/*.spec.ts` (kategoriler, marketler, ürünler, toplu
teklif, genel arama, uygulanmamış RPC'ler): gerçek sunucu, gerçek istemci, dış bağımlılık yok. Düzenek
`test/support/catalog-grpc-harness.ts` (sunucu ve çağrı `@getir/service-kit/testing`'ten, D5); hata
metadata'sı ortak `appErrorOf` ile Zod'dan geçerek okunur.

## Docker

```bash
docker build -f apps/catalog-service/Dockerfile -t getir/catalog-service .
docker run --rm -p 50051:50051 -e MOCK=true getir/catalog-service
node scripts/check-node-image.mjs getir/catalog-service   # imaj denetimi (D12), CI'da da kosar
```

Build bağlamı **depo köküdür**. İmaj çok aşamalıdır, `node` kullanıcısıyla çalışır ve
`HEALTHCHECK` servisin kendi `grpc.health.v1` ucunu sorar.

Çalışma klasöründe (`/app`) yalnızca `dist`, `node_modules` ve `package.json` bulunur: `pnpm deploy`
servisin kendi dosyalarından yalnızca `package.json` `files` alanını (`["dist"]`) kopyalar (D12).
Kaynakta import edilen her paket `dependencies`'te olmalı; `devDependencies` imaja girmez. D12'de
`@getir/contracts` bu yüzden taşındı: D6'dan beri `src/` onu kullanıyordu, imaj açılışta
`ERR_MODULE_NOT_FOUND` ile düşüyordu. İmajdaki seed (`node dist/seed.js`) `NODE_ENV=production`
iken bilerek çalışmaz; geliştirme verisi için `-e NODE_ENV=development` verilir.

Testler: `pnpm test:unit` (bellek, sözleşmeler, use-case'ler, veri bütünlüğü, gRPC) ve
`pnpm test:int` (gerçek Mongo: sözleşmeler, seed sayıları ve tekrarı, indeksler, transaction
geri alma, 3 demo adresinin 2dsphere'e karşı doğru marketleri listelemesi, sorgu planları ve genel
aramanın bellek uygulamasıyla aynı sonucu vermesi).
