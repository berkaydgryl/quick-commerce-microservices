# @getir/courier-service

Kurye servisi: `couriers` koleksiyonunun **tek sahibi** (ADR-05). Siparişe kurye atar ve bırakır.
Siparişin durumunu değiştirmez; atamayı order ister, sonucu kendi belgesine yazar ve `PREPARING`'e
geçer (T13.1 PR 2). Canlı konum bu servisin RPC'lerinden geçmez (`courier.proto` başı).

**Kurye havuzu (T13.2):** kurye bir markete bağlı değildir. Siparişin marketinin **3 km**
çevresindeki boş kuryelerden biri atanır; demo verisinde Kadıköy ve Beşiktaş iki ayrı havuzdur
(aralarında 6,6 km). Teslimattan sonra kurye olduğu yerde boşa çıkar, markete dönmez.

## Bugünkü durum (T13.2 PR 1 — kurye havuzu)

| Parça                        | Durum                                                                                       |
| ---------------------------- | ------------------------------------------------------------------------------------------- |
| `couriers` şeması            | ✅ `infrastructure/mongo/documents.ts` (konum GeoJSON), indeksler `couriers-collection.ts`  |
| Havuz ataması (B7)           | ✅ `application/assign-courier.ts` + `nearest-available.ts`, kural `domain/courier-pool.ts` |
| Market konumu kopyası        | ✅ `markets` koleksiyonu (seed ve göç 0001 yazar), MOCK'ta bellek                           |
| Okuma, bırakma               | ✅ `GetCourier`, `ReleaseCourier` (kurye olduğu yerde boşa çıkar)                           |
| Demo kuryeleri               | ✅ `pnpm seed`: her marketin 40-150 m yakınına 3 kurye, 63 (Kadıköy 30, Beşiktaş 33)        |
| Rota, ETA, GPS, `StartRoute` | ⏳ T13.2 PR 3 (rota, ETA), T13.3 (GPS); `StartRoute` bugün `NOT_IMPLEMENTED`                |

## RPC'ler

| RPC              | Ne yapar                                                                                 |
| ---------------- | ---------------------------------------------------------------------------------------- |
| `AssignCourier`  | Marketin çevresindeki boş kuryeyi bağlar; yoksa `NOT_FOUND` (order 30 sn bekler)         |
| `GetCourier`     | Kuryenin durumu ve son bilinen konumu; yoksa `NOT_FOUND`                                 |
| `ReleaseCourier` | Siparişi taşıyan kuryeyi yerinde `IDLE` yapar; taşıyan yoksa hata değil `released=false` |
| `StartRoute`     | `NOT_IMPLEMENTED` (T13.2)                                                                |

Girdi sözleşme biçimiyle denetlenir: sipariş `ord_<32 hex>`, market `mkt_…`, kurye `crr_<32 hex>`,
teslimat konumu zorunlu. Kullanımdan kalkan `dark_store_id` okunmaz (ADR-15). Cevaptaki kuryenin
`market_id` alanı artık doldurulmaz (havuz); alan sözleşmeden silinmez.

## Atama kuralı: havuz (T13.2, B7)

- **Havuz:** siparişin marketinin konumu servisin kendi kopyasından (`markets`) okunur; o noktanın
  **3 km** (`COURIER_POOL_RADIUS_METERS`) içindeki `IDLE` kuryeler havuzdur. `BUSY` ve `OFFLINE`
  girmez. Market kopyada yoksa `NOT_FOUND` (`reason: market_unknown`) ve WARN; order 30 sn sonra
  yeniden dener, döngüye girmez.
- **Sıra (#88):** önce **300 m'lik yakınlık dilimi** (`floor(mesafe / 300)`), dilim içinde **en uzun
  süredir boşta** olan (`idleSince`), eşitlikte kimlik. Neden dilim: tam mesafe eşitliği nadir; salt
  "en yakın" kuralı birbirine yakın kuryelerden hep aynı birine iş verirdi. Dilim içinde bekleme
  süresi adaleti sağlar, uzaktaki kurye yakındakinin önüne geçmez.
- **Atomik (B7):** `$geoNear` (2dsphere indeksi) sıraya göre en fazla 5 aday okur; adaylar sırayla
  **koşullu** alınır: `findOneAndUpdate({ _id, status: IDLE }, BUSY + currentOrderId + lastAssignedAt,
idleSince silinir)`. Aday o arada başka siparişe gittiyse koşul tutmaz, sıradakine geçilir; kaybedilen
  adaylar sonraki okumada dışlanır (`_id: { $nin }`) ve liste boşalana kadar denenir (üst sınır havuz
  büyüklüğü). `NOT_FOUND` yalnızca "havuzda boş kurye kalmadı" demektir, bellekte ve Mongo'da aynı.
  İki sipariş aynı kuryeyi alamaz (entegrasyon testi: tek kurye, 20 eşzamanlı sipariş → 1 atama;
  5 kurye, 30 sipariş → 5 farklı atama; 30 kurye aynı noktada, 20 sipariş → 20 farklı atama). B7'deki
  hata "oku, sonra körlemesine yaz"dı; burada yazım "hâlâ boşsa" koşullu.
- **Tekrar güvenli:** sipariş zaten bir kuryedeyse aynısı döner. `currentOrderId` üzerindeki kısmi
  benzersiz indeks, aynı sipariş için eşzamanlı ikinci isteği durdurur; kaybeden kazananın kuryesini
  okur (test: aynı sipariş 10 kez eşzamanlı → tek kurye).
- **ETA:** atama cevabında `eta_seconds = 0` (hesaplanmadı); rota ve ETA T13.2 PR 3'te.
- **Bırakma:** kurye olduğu yerde `IDLE` olur, `idleSince` bırakma anı; `lastAssignedAt` geçmiş
  bilgisi olarak kalır. Konum Mongo'da durum değişiminde yazılır: teslimat bitince adres (T13.3/T14.3).

## `couriers` ve `markets` belgeleri

`couriers`: `_id (crr_…)`, `name`, `status` (`IDLE | BUSY | OFFLINE`), `currentOrderId?`,
`lastAssignedAt?`, `idleSince?` (yalnızca `IDLE`), `lastLocation` (GeoJSON `Point`, `[boylam, enlem]`),
`lastLocationAt`. Canlı konum her tick'te Redis'e gider ve Mongo'ya yazılmaz (T13.3, T14.1).

İndeksler: `lastLocation_2dsphere_status` (havuz sorgusu, `$geoNear`) ve `currentOrderId_unique`
(kısmi: yalnızca alanı olan belgeler).

`markets`: `_id (mkt_…)`, `location` (GeoJSON). Market kaydının sahibi catalog'dur; burası havuzun
merkezi için **kopyadır**. Seed ve göç 0001 yazar; katalogun demo verisiyle eşitliği testli
(`test/unit/courier-fixtures.spec.ts`). Kopya katalogla eşlenmez (bekleyen iş #93: olayla ya da açılışta
okuyarak): katalogda yeni market courier'de `market_unknown` olur; courier seed'i ya da göç gerekir.

**Göç 0001 (`kurye-havuzu`):** T13.1 biçimindeki kuryeleri çevirir (konum GeoJSON, `marketId` silinir,
`IDLE`'a `idleSince`: son atama ya da seed anı), eski `marketId_status_lastAssignedAt` indeksini düşürür
ve 21 marketin konumunu yazar. Açılışta kendiliğinden uygulanır; `down` geri alır (`marketId` en yakın
marketten). Transaction'sız ve yeniden çalıştırılabilir (indeks düşürmek transaction'da yapılamaz).

Kuryenin adı istemcide görünür, **günlüğe yazılmaz**; günlükte kimlik yeter.

## Çalıştırma

```bash
pnpm --filter @getir/courier-service build
MOCK=true pnpm --filter @getir/courier-service start   # :50056, demo kuryeleri bellekte
pnpm --filter @getir/courier-service seed              # 63 kurye + 21 market konumu (tekrar koşmak sıfırlar)
pnpm --filter @getir/courier-service migrate status

grpcurl -plaintext -import-path packages/proto/proto -proto getir/courier/v1/courier.proto \
  -d '{"order_id":"ord_0123456789abcdef0123456789abcdef","market_id":"mkt_migros-jet-moda","delivery_location":{"lat":40.99,"lng":29.03}}' \
  localhost:50056 getir.courier.v1.CourierService/AssignCourier
```

Metrikler `:51056/metrics` (gRPC portu + 1000).

## Ortam

| Değişken            | Varsayılan      | Not                                                     |
| ------------------- | --------------- | ------------------------------------------------------- |
| `COURIER_GRPC_PORT` | `50056`         |                                                         |
| `COURIER_MONGO_URI` | —               | `MOCK=false` iken zorunlu; kendi kullanıcısı (D14)      |
| `COURIER_MONGO_DB`  | `getir_courier` |                                                         |
| `MOCK`              | `false`         | `true`: demo kuryeleri ve marketler bellekte, Mongo yok |

**Yerel Mongo'da kullanıcı:** `infra/docker/mongo/init/service-users.js` kullanıcıları yalnızca **boş
hacimde** oluşturur. Daha önce kurulmuş bir `getir-mongo`'da `courier` kullanıcısı kendiliğinden
oluşmaz: `.env`'e `COURIER_MONGO_URI` ve `COURIER_MONGO_DB` eklenir, kullanıcı bir kez
`pnpm infra:mongosh` ile oluşturulur (`readWrite` → `getir_courier`) ya da hacim sıfırlanır
(`pnpm infra:reset`, veri gider).
