# infra/seed

Demo verisinin **çalıştırma** tarafı. Veri, sahibi olan servisin içinde durur; burada yalnızca
henüz sahibi ayakta olmayan veri ve bu düzenin açıklaması var.

## Kim neyi yükler

| Veri                                     | Sahibi (ADR-05) | Nerede                                              | Ne zaman yüklenir                  |
| ---------------------------------------- | --------------- | --------------------------------------------------- | ---------------------------------- |
| 5 kategori, 15 ürün, 6 market, 71 teklif | catalog         | `apps/catalog-service/src/infrastructure/fixtures/` | `pnpm seed` (T4.1, pazaryeri T4.8) |
| 3 hazır adres                            | gateway (users) | `infra/seed/data/addresses.json`                    | T8.1 — `users.addresses[]`         |
| Stok                                     | inventory       | —                                                   | T9.1                               |
| 3 kurye                                  | courier         | —                                                   | T13.1                              |

**Neden veri servisin içinde (roadmap `infra/seed/data/*.json` diyordu):**

1. Bir koleksiyona yalnızca sahibi yazar (ADR-05). Seed de bir yazımdır; servisin kendi
   repository'si, indeks tanımları ve transaction'ı üzerinden geçer.
2. `MOCK=true` modunda servis aynı veriyi bellekten döndürür. `.dockerignore` `infra/`'yı imaja
   almaz; veri burada dursaydı MOCK modundaki konteyner onu bulamazdı.
3. Tek kopya: MOCK modu ile gerçek mod aynı katalogu gösterir.

## Adresler

`data/addresses.json`, `@getir/contracts` içindeki `deliveryAddressSchema` biçimindedir ve
roadmap'in adres tablosunu izler:

| Başlık | Konum          | Beklenen                                                                         |
| ------ | -------------- | -------------------------------------------------------------------------------- |
| Ev     | Kadıköy merkez | 3 market: A101 – Caferağa, Kardeşler Manavı, Migros Jet – Moda                   |
| İş     | Beşiktaş       | 3 market: Migros Jet – Beşiktaş, Carrefour Express, A101 – Abbasağa (**kapalı**) |
| Yazlık | Şile           | Boş liste: "bölgende market yok"                                                 |

`users` koleksiyonu gateway'e aittir ve T8.1'de açılır; adresler o gün oraya yüklenecek. O güne
kadar bu dosya, gerçek `ListNearbyMarkets` use-case'ine seed edilmiş Mongo üzerinden verilir
(`apps/catalog-service/test/integration/mongo-catalog.spec.ts`, T4.8): konum verisinde bir kayma
olursa demo senaryosu bozulmadan önce test kırmızı olur.

## Komutlar

```bash
pnpm infra:up     # Mongo (replica set) + Redis
pnpm seed         # catalog'u derler ve katalogu bastan yazar (tekrar kosmak guvenli)
```
