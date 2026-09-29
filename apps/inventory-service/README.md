# @getir/inventory-service

Stok gerçeğinin **tek sahibi** (ADR-03, ADR-05): market × SKU için eldeki adet. Başka hiçbir
servis `stock` koleksiyonuna ya da `stock:{market}:avail:{sku}` sayaçlarına dokunmaz; stok
yalnızca `getir.inventory.v1.InventoryService` RPC'leri üzerinden okunur ve (T10'dan sonra)
hareket eder.

Bu serviste **olmayanlar**, bilinçli: ürün adı, fiyatı ve kategorisi `catalog-service`'in;
sipariş durumu ve rezervasyon süresinin **ne kadar** olacağı `order-service`'in işidir.

## Bugünkü durum (T9.1 + T9.2)

| RPC                 | Durum                                                                                                             |
| ------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `CheckAvailability` | ✅ Toplu (en fazla 100 SKU, B27): satılabilir adetler + `unknown_skus` (bu markette kaydı olmayan ya da biçimsiz) |
| `Reserve`           | ⏳ `NOT_IMPLEMENTED` (gRPC `UNIMPLEMENTED`, HTTP 501) — T10.1 (`reserve.lua`)                                     |
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

## Açılış (T9.2)

1. Mongo'ya bağlanır, `stock` indeksini kurar; Redis'e bağlanır.
2. **Redis tahliye politikası** (`maxmemory-policy`) okunur: `noeviction` değilse ya da okunamıyorsa
   servis **açılmaz** (roadmap P1). Bellek dolunca sayacı silen bir Redis fazla satış demektir.
3. Sayaçlar Mongo'dan yazılır, **yalnızca olmayanlar** (`SET NX`): var olan sayaç rezervasyonları
   yansıtır (T10); ezilseydi ayrılmış stok yeniden satılırdı.
4. gRPC portu **ancak bundan sonra** açılır: sayaçlar yazılmadan servis hazır görünmez.

`MOCK=true` iken Mongo ve Redis'e hiç dokunulmaz; demo stoğu bellektedir.

## Komutlar

```bash
pnpm seed                                            # kokten: katalog + stok (Mongo), sayaçlar (Redis) baştan
pnpm --filter @getir/inventory-service reseed         # Redis sayaçlarını Mongo'dan BAŞTAN yazar
pnpm --filter @getir/inventory-service build && MOCK=true pnpm --filter @getir/inventory-service start  # :50052

grpcurl -plaintext -import-path packages/proto/proto -proto getir/inventory/v1/inventory.proto \
  -d '{"market_id":"mkt_migros-jet-moda","skus":["SUT-1L","KOLA-1L","CIKOLATA-80"]}' \
  localhost:50052 getir.inventory.v1.InventoryService/CheckAvailability
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
src/
  application/     check-availability, seed-stock, seed-counters (use-case'ler)
  domain/          stock.ts: kavramlar ve portlar (depo yok)
  infrastructure/  fixtures, memory (MOCK), mongo (stock), redis (sayaçlar, tahliye denetimi),
                   stock-stores (bağlantılar), stock-source (açılış)
  interfaces/grpc/ handler, şema (Zod), eşleyici
  main.ts · seed.ts · reseed.ts · healthcheck.ts
```
