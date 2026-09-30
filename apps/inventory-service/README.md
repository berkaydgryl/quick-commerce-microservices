# @getir/inventory-service

Stok gerçeğinin **tek sahibi** (ADR-03, ADR-05): market × SKU için eldeki adet. Başka hiçbir
servis `stock` koleksiyonuna ya da `stock:{market}:avail:{sku}` sayaçlarına dokunmaz; stok
yalnızca `getir.inventory.v1.InventoryService` RPC'leri üzerinden okunur ve (T10'dan sonra)
hareket eder.

Bu serviste **olmayanlar**, bilinçli: ürün adı, fiyatı ve kategorisi `catalog-service`'in;
sipariş durumu ve rezervasyon süresinin **ne kadar** olacağı `order-service`'in işidir.

## Bugünkü durum (T9.1 + T9.2 + T10.1)

| RPC                 | Durum                                                                                                             |
| ------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `CheckAvailability` | ✅ Toplu (en fazla 100 SKU, B27): satılabilir adetler + `unknown_skus` (bu markette kaydı olmayan ya da biçimsiz) |
| `Reserve`           | ✅ Sepetin tamamı tek atomik adımda ya da hiç (`reserve.lua`, T10.1); aşağıda                                     |
| `Commit`, `Release` | ⏳ `NOT_IMPLEMENTED` — T10.2 (`commit.lua`, `release.lua`, `stock_ledger`)                                        |
| `ExtendReservation` | ⏳ `NOT_IMPLEMENTED` — T10                                                                                        |
| `GetReservation`    | ⏳ `NOT_IMPLEMENTED` — T10                                                                                        |

## Stok nerede durur (ADR-03)

| Depo  | Anahtar / koleksiyon                   | İş                                                                  |
| ----- | -------------------------------------- | ------------------------------------------------------------------- |
| Mongo | `stock` (`marketId`+`sku` benzersiz)   | Kalıcı gerçek: eldeki adet, `version` (iyimser kilit, T10.2)        |
| Redis | `stock:{market}:avail:{sku}` (TTL'siz) | Sıcak yolun karar mercii; `CheckAvailability` yalnızca buradan okur |

- **Toplu okuma:** bir marketin bütün sayaçları aynı hash-tag'dedir (`{market}`); istek tek `MGET`.
- **Bilinmeyen SKU** hata değildir, `unknown_skus`'a düşer: "bu markette satılmıyor" ile "tükendi" (0)
  ayrımı buradan çıkar. Biçimi bozuk SKU da oraya düşer; tek hatalı kalem bütün listeyi düşürmez.
  **Bilinmeyen market** da hata değildir: marketin varlığı kataloğun işidir, SKU'lar `unknown_skus`'tadır.
- **Negatif sayaç** (fazla satış izi) 0 döner ve uyarı yazılır; tam sayı olmayan sayaç `INTERNAL`.
- **Sayaçlar TTL'sizdir** (ADR-03; proje kurallarındaki Redis TTL istisnası): süresi dolan bir önbellek
  değil, stok kararının kendisidir.

## Rezervasyon (T10.1)

`Reserve` sepetin **tamamını** tek bir Redis Lua script'inde (`lua/reserve.lua`) ayırır ya da **hiçbirini**
(ADR-01). Redis script'i tek iş parçacığında çalıştırdığı için kontrol ile düşüm arasına başka istek
giremez: kısmi rezervasyon imkânsızdır. Rezervasyonun kimliği siparişin kimliğidir (`order_id`).

| Anahtar                      | Tip    | İçerik                                                                                    | Ömür         |
| ---------------------------- | ------ | ----------------------------------------------------------------------------------------- | ------------ |
| `stock:{market}:avail:{sku}` | string | Satılabilir adet; rezervasyon buradan düşer                                               | TTL'siz      |
| `resv:{market}:{orderId}`    | hash   | `qty:{sku}` (B23), `orderId`, `userId`, `marketId`, `reservedAt`, `expiresAt`, `extended` | süre + 60 sn |
| `resv:index:{market}`        | zset   | üye sipariş, skor bitiş anı (ms); süpürücü buradan okur (T10.3)                           | TTL'siz      |
| `resv:user:{userId}`         | string | Kullanıcının aktif siparişi (B22)                                                         | süre kadar   |

**Script'in adımları** (anahtar sırası B15):

1. Sipariş zaten rezerveyse sayaçlara dokunmadan döner.
2. Kullanıcının başka aktif rezervasyonu varsa reddeder.
3. Bütün sayaçları okur, **hiçbir şey yazmaz**; biri yetmezse, yoksa ya da tam sayı değilse çıkar.
4. Hepsini birden düşer; kaydı, indeksi ve kullanıcı kilidini yazar.

| Sonuç                           | gRPC / hata kodu                             | Ayrıntı                                                           |
| ------------------------------- | -------------------------------------------- | ----------------------------------------------------------------- |
| Rezerve edildi                  | OK, `expires_at`                             |                                                                   |
| Sipariş zaten rezerve           | OK, `already_reserved: true`, ilk bitiş anı  | Sayaçlar ikinci kez düşmez (ADR-08)                               |
| Bir kalem yetmedi               | `FAILED_PRECONDITION` / `STOCK_INSUFFICIENT` | `sku`, `requested`, `available` (yetmeyen ilk kalem)              |
| Sayacı olmayan SKU (#36)        | `FAILED_PRECONDITION` / `STOCK_INSUFFICIENT` | `available: 0`, `counterMissing: true`; uyarı günlüğü             |
| Kullanıcının aktif rezervasyonu | `ALREADY_EXISTS` / `RESERVATION_ACTIVE`      | `activeOrderId`; eskisini bırakıp yenisini almak order'ın (T11.2) |
| Bozuk (tam sayı olmayan) sayaç  | `INTERNAL`                                   | Hiçbir şey yazılmaz                                               |

- **Kararlar (30 Eylül, (a)x6):**
  - Kullanıcı kilidi kullanıcı başına tek anahtar. Market anahtarlarından ayrı slot'ta; tek düğümlü Redis'te
    çalışır, Cluster'a geçişte yeniden karar gerekir. Script bunu yüklemede beyan eder
    (`loadLuaScripts({ crossSlot })`), çağrı başına uyarı yazılmaz.
  - Sayacı olmayan SKU yetersiz sayılır.
  - Aynı SKU iki kalemde `VALIDATION_FAILED`. Depolar da aynı kuralla korunur; yoksa sayaç iki kez düşerdi.
- **Doğrulama:** sipariş (`ord_`) ve kullanıcı (`usr_`) kimliği biçimiyle doğrulanır, ikisi de Redis anahtarına girer.
  Kalem ve adet sınırları sepetinkiyle aynı (en fazla 50 kalem, kalem başına 1-99). Süre 30-900 sn; bu bir
  korumadır, süreyi order verir (risk bandı: 600 / 120).
- **Saat:** "şimdi" servisin saatidir (`Clock`); testler sabit saat verir.
- **MOCK** (B16): bellekte aynı kurallar; sayaçlar ve rezervasyonlar aynı haritayı paylaşır, rezervasyon
  müsaitlikte hemen görünür. İki uygulama da `test/support/reservation-store-contract.ts` senaryolarından geçer.
- **Henüz yok:**
  - Onay ve bırakma (`commit.lua`, `release.lua`, `stock_ledger`) T10.2'de.
  - Süresi dolan rezervasyonun stoğunu geri veren süpürücü T10.3'te; o gelene kadar süresi dolan
    rezervasyonun stoğu geri gelmez.
  - Redis boşalınca bunu kendiliğinden fark edip sayaçları yeniden yazmak (#36'nın ikinci yarısı) T10.1 PR 2'de.
  - Order'ın `Reserve`'ü çağırması T11.2'de.

## Açılış (T9.2)

1. Mongo'ya bağlanır, `stock` indeksini kurar; Redis'e bağlanır.
2. **Redis tahliye politikası** (`maxmemory-policy`) okunur: `noeviction` değilse ya da okunamıyorsa
   servis **açılmaz** (roadmap P1). Bellek dolunca sayacı silen bir Redis fazla satış demektir.
3. Sayaçlar Mongo'dan yazılır, **yalnızca olmayanlar** (`SET NX`): var olan sayaç rezervasyonları
   yansıtır (T10); ezilseydi ayrılmış stok yeniden satılırdı.
4. Lua script'leri (`lua/`) Redis'e yüklenir (T10.1): klasör eksikse servis açılmaz, ilk rezervasyonda
   patlamaz. Redis yeniden başlayıp script'i unutursa ilk çağrı yeniden yükler (redis-kit, `NOSCRIPT`).
5. gRPC portu **ancak bundan sonra** açılır: sayaçlar yazılmadan servis hazır görünmez.

`MOCK=true` iken Mongo ve Redis'e hiç dokunulmaz; demo stoğu bellektedir.

## Komutlar

```bash
pnpm seed                                            # kokten: katalog + stok (Mongo), sayaçlar (Redis) baştan
pnpm --filter @getir/inventory-service reseed         # Redis sayaçlarını Mongo'dan BAŞTAN yazar
pnpm --filter @getir/inventory-service build && MOCK=true pnpm --filter @getir/inventory-service start  # :50052

grpcurl -plaintext -import-path packages/proto/proto -proto getir/inventory/v1/inventory.proto \
  -d '{"market_id":"mkt_migros-jet-moda","skus":["SUT-1L","KOLA-1L","CIKOLATA-80"]}' \
  localhost:50052 getir.inventory.v1.InventoryService/CheckAvailability

grpcurl -plaintext -import-path packages/proto/proto -proto getir/inventory/v1/inventory.proto \
  -d '{"order_id":"ord_00000000000000000000000000000001","market_id":"mkt_migros-jet-moda",
       "user_id":"usr_00000000000000000000000000000001","ttl_seconds":600,
       "items":[{"sku":"SUT-1L","quantity":2},{"sku":"CIKOLATA-80","quantity":1}]}' \
  localhost:50052 getir.inventory.v1.InventoryService/Reserve
```

- **`seed`** kalıcı stoğu tek transaction'da baştan yazar ve sayaçları ondan yeniden kurar (seed stok
  gerçeğini topluca değiştirir; sayaçlar yenilenmezse Redis eski stoğu gösterirdi). `NODE_ENV=production`
  iken reddeder.
- **`reseed`** Redis boşaltıldığında ya da kaybedildiğinde kullanılır: "Redis silinip yeniden kurulur"
  (ADR-03: Redis kaybı veri kaybı değil, yeniden ısınma maliyetidir). **T10'dan sonra dikkat:** aktif
  rezervasyon varken çalıştırılırsa ayrılmış stok geri satışa çıkar; Redis boşken ya da rezervasyon
  yokken koşulur.

## Demo stoğu

`src/infrastructure/fixtures/stock-levels.ts`: kataloğun 71 teklifinin **her birinin** stok kaydı var
(`test/unit/stock-fixtures.spec.ts` kataloğun demo verisiyle karşılaştırır). Bilerek konanlar:

- her markette bir **"tükendi"** (0) ve bir **"son 2 adet"** kalemi;
- Migros Jet – Moda'da çikolata **1 adet**: yarış senaryosu (T11.1, "stok 1, 100 paralel istek");
- diğerleri 20-60 arası, sabit: tekrar koşan seed aynı stoğu yazar.

## Klasörler

```text
lua/               reserve.lua (T10.1); imaja package.json "files" ile girer
src/
  application/     check-availability, reserve-stock, seed-stock, seed-counters (use-case'ler)
  domain/          stock.ts, reservation.ts, stock-ports.ts: kavramlar ve portlar (depo yok)
  infrastructure/  fixtures, memory (MOCK: sayaçlar + rezervasyon), mongo (stock),
                   redis (sayaçlar, rezervasyon, Lua yükleyici, tahliye denetimi),
                   stock-stores (bağlantılar), stock-source (açılış)
  interfaces/grpc/ handler, şema (Zod), eşleyici
  main.ts · seed.ts · reseed.ts · healthcheck.ts
```
