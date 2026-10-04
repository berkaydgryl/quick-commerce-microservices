# @getir/courier-service

Kurye servisi: `couriers` koleksiyonunun **tek sahibi** (ADR-05). Siparişe kurye atar ve bırakır.
Siparişin durumunu değiştirmez; atamayı order ister, sonucu kendi belgesine yazar ve `PREPARING`'e
geçer (T13.1 PR 2). Canlı konum bu servisin RPC'lerinden geçmez (`courier.proto` başı).

## Bugünkü durum (T13.1 — kurye ataması)

| Parça                        | Durum                                                                                                            |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `couriers` şeması            | ✅ `infrastructure/mongo/documents.ts`, indeksler `couriers-collection.ts`                                       |
| Atama (B7)                   | ✅ `application/assign-courier.ts` + `AssignmentStrategy`: en uzun süredir iş almamış kurye önce (son atama anı) |
| Okuma, bırakma               | ✅ `GetCourier`, `ReleaseCourier`                                                                                |
| Demo kuryeleri               | ✅ `pnpm seed`: katalogdaki her markete 3 kurye (`infrastructure/fixtures`)                                      |
| Rota, ETA, GPS, `StartRoute` | ⏳ T13.2–T13.3; `StartRoute` bugün `NOT_IMPLEMENTED`                                                             |

## RPC'ler

| RPC              | Ne yapar                                                                                 |
| ---------------- | ---------------------------------------------------------------------------------------- |
| `AssignCourier`  | Marketin boş kuryesini siparişe bağlar; boş kurye yoksa `NOT_FOUND` (order 30 sn bekler) |
| `GetCourier`     | Kuryenin durumu ve son bilinen konumu; yoksa `NOT_FOUND`                                 |
| `ReleaseCourier` | Siparişi taşıyan kuryeyi `IDLE`'a döndürür; taşıyan yoksa hata değil `released = false`  |
| `StartRoute`     | `NOT_IMPLEMENTED` (T13.2)                                                                |

Girdi sözleşme biçimiyle denetlenir: sipariş `ord_<32 hex>`, market `mkt_…`, kurye `crr_<32 hex>`,
teslimat konumu zorunlu. Kullanımdan kalkan `dark_store_id` okunmaz (ADR-15).

## Atama kuralı (B7)

- **Atomik:** tek `findOneAndUpdate` marketin `IDLE` kuryesini aynı anda `BUSY` yapar, siparişe bağlar
  (`currentOrderId`) ve atama anını (`lastAssignedAt`) yazar. İki sipariş aynı kuryeyi alamaz
  (entegrasyon testi: tek kurye, 20 eşzamanlı sipariş → 1 atama, 19 `NOT_FOUND`).
- **Sıra:** en uzun süredir iş almamış kurye önce (son atama anı); hiç atanmamış en önde, eşitlikte
  kimlik. `OFFLINE` havuza girmez. Akıllı atama (mesafe, yük) `domain/assignment-strategy.ts`
  arayüzünün arkasına gelir.
- **Tekrar güvenli:** sipariş zaten bir kuryedeyse aynısı döner. `currentOrderId` üzerindeki kısmi
  benzersiz indeks, aynı sipariş için eşzamanlı ikinci isteği durdurur; kaybeden kazananın kuryesini
  okur (test: aynı sipariş 10 kez eşzamanlı → tek kurye).
- **ETA:** atama cevabında `eta_seconds = 0` (hesaplanmadı); rota ve ETA T13.2'de.
- **Bırakma:** `lastAssignedAt` silinmez; sıra son atama anına göredir, boşta bekleme süresine
  değil. Uzun bir teslimattan yeni dönen kurye, ondan sonra atanıp çoktan boşalmış kuryenin önüne
  geçebilir. Boşta bekleme süresine ya da mesafeye göre adil atama `AssignmentStrategy`'nin
  arkasına gelir (bekleyen iş #88).

## `couriers` belgesi

`_id (crr_…)`, `name`, `marketId`, `status` (`IDLE | BUSY | OFFLINE`), `currentOrderId?`,
`lastAssignedAt?`, `lastLocation {lat, lng}`, `lastLocationAt`. Konum Mongo'da yalnızca durum
değişiminde durur (seed'de marketin konumu); canlı konum her tick'te Redis'e gider ve Mongo'ya
yazılmaz (T13.3, T14.1).

İndeksler: `marketId_status_lastAssignedAt` (atama sorgusu; sıralama da indeksten) ve
`currentOrderId_unique` (kısmi: yalnızca alanı olan belgeler).

Kuryenin adı istemcide görünür, **günlüğe yazılmaz**; günlükte kimlik yeter.

## Çalıştırma

```bash
pnpm --filter @getir/courier-service build
MOCK=true pnpm --filter @getir/courier-service start   # :50056, demo kuryeleri bellekte
pnpm --filter @getir/courier-service seed              # Mongo'ya 63 kurye (tekrar koşmak sıfırlar)
pnpm --filter @getir/courier-service migrate status

grpcurl -plaintext -import-path packages/proto/proto -proto getir/courier/v1/courier.proto \
  -d '{"order_id":"ord_0123456789abcdef0123456789abcdef","market_id":"mkt_migros-jet-moda","delivery_location":{"lat":40.99,"lng":29.03}}' \
  localhost:50056 getir.courier.v1.CourierService/AssignCourier
```

Metrikler `:51056/metrics` (gRPC portu + 1000).

## Ortam

| Değişken            | Varsayılan      | Not                                                        |
| ------------------- | --------------- | ---------------------------------------------------------- |
| `COURIER_GRPC_PORT` | `50056`         |                                                            |
| `COURIER_MONGO_URI` | —               | `MOCK=false` iken zorunlu; kendi kullanıcısı (D14)         |
| `COURIER_MONGO_DB`  | `getir_courier` |                                                            |
| `MOCK`              | `false`         | `true`: demo kuryeleri bellekte, Mongo yok (imaj denetimi) |

**Yerel Mongo'da kullanıcı:** `infra/docker/mongo/init/service-users.js` kullanıcıları yalnızca **boş
hacimde** oluşturur. Daha önce kurulmuş bir `getir-mongo`'da `courier` kullanıcısı kendiliğinden
oluşmaz: `.env`'e `COURIER_MONGO_URI` ve `COURIER_MONGO_DB` eklenir, kullanıcı bir kez
`pnpm infra:mongosh` ile oluşturulur (`readWrite` → `getir_courier`) ya da hacim sıfırlanır
(`pnpm infra:reset`, veri gider).
