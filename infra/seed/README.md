# infra/seed

Demo verisinin **çalıştırma** tarafı. Veri, sahibi olan servisin içinde durur; burada yalnızca
henüz sahibi ayakta olmayan veri ve bu düzenin açıklaması var.

## Kim neyi yükler

| Veri                                          | Sahibi (ADR-05) | Nerede                                                             | Ne zaman yüklenir                                 |
| --------------------------------------------- | --------------- | ------------------------------------------------------------------ | ------------------------------------------------- |
| 13 kategori, 122 ürün, 33 market, 1505 teklif | catalog         | `apps/catalog-service/src/infrastructure/fixtures/`                | `pnpm seed` (T4.1, pazaryeri T4.8)                |
| 3 hazır adres                                 | gateway (users) | `apps/gateway/internal/persona/addresses.json`                     | `pnpm seed:personas` (T8.1) — `users.addresses[]` |
| 5 persona hesabı + Ali'nin 3 ek hesabı        | gateway (users) | `apps/gateway/internal/persona/personas.json`                      | `pnpm seed:personas` (T8.1); MOCK'ta açılışta     |
| Personaların sipariş geçmişi                  | order           | `apps/order-service/src/infrastructure/fixtures/persona-orders.ts` | `pnpm seed:personas` (T8.1); MOCK'ta açılışta     |
| Stok                                          | inventory       | —                                                                  | T9.1                                              |
| 99 kurye (marketlerin yakını) + 33 konum      | courier         | `apps/courier-service/src/infrastructure/fixtures/couriers.ts`     | `pnpm seed` (T13.1; havuz ve konumlar T13.2)      |

**Neden veri servisin içinde (roadmap `infra/seed/data/*.json` diyordu):**

1. Bir koleksiyona yalnızca sahibi yazar (ADR-05). Seed de bir yazımdır; servisin kendi
   repository'si, indeks tanımları ve transaction'ı üzerinden geçer.
2. `MOCK=true` modunda servis aynı veriyi bellekten döndürür. `.dockerignore` `infra/`'yı imaja
   almaz; veri burada dursaydı MOCK modundaki konteyner onu bulamazdı.
3. Tek kopya: MOCK modu ile gerçek mod aynı katalogu gösterir.

## Adresler

`apps/gateway/internal/persona/addresses.json` (T8.1'e kadar burada, `data/addresses.json`;
sahibi gateway ayağa kalkınca oraya taşındı), `@getir/contracts` içindeki `savedAddressSchema` (kayıtlı adres: teslimat
adresi + etiket + not) biçimindedir; siparişe giderken yalnızca `line` ve `location` taşınır (T7.5) ve
roadmap'in adres tablosunu izler:

| Başlık | Konum          | Beklenen                                                                         |
| ------ | -------------- | -------------------------------------------------------------------------------- |
| Ev     | Kadıköy merkez | 3 market: A101 – Caferağa, Kardeşler Manavı, Migros Jet – Moda                   |
| İş     | Beşiktaş       | 3 market: Migros Jet – Beşiktaş, Carrefour Express, A101 – Abbasağa (**kapalı**) |
| Yazlık | Şile           | Boş liste: "bölgende market yok"                                                 |

`users` koleksiyonu gateway'e aittir (T8.1): adresler persona hesaplarının `addresses[]`
alanına yüklenir; `GET /v1/me/addresses` okur (T9.5), web ana sayfadaki adres seçicide gösterir. Dosya ayrıca gerçek
`ListNearbyMarkets` use-case'ine seed edilmiş Mongo üzerinden sınanır
(`apps/catalog-service/test/integration/mongo-catalog.spec.ts`, T4.8): konum verisinde bir kayma
olursa demo senaryosu bozulmadan önce test kırmızı olur.

## Personalar (T8.1)

Risk bandlarının her biri için hazır hesap: Ayşe (LOW), Zeynep (MEDIUM), Can (HIGH), Ali
(CRITICAL), Komşu (LOW). Hesaplar ve gateway sinyalleri (hesap yaşı, hesabın açıldığı cihaz, son
bilinen konum) gateway'de; sipariş geçmişleri order-service'te. Telefonlar, demo şifresi ve
beklenen bantlar: `apps/gateway/README.md` "Demo personaları". Yalnızca yerel/MOCK: production'da
iki seed de reddeder.

## Komutlar

```bash
pnpm infra:up     # Mongo (replica set) + Redis
pnpm seed         # catalog'u derler ve katalogu bastan yazar (tekrar kosmak guvenli)
pnpm seed:personas  # personalar: order-service gecmisi + gateway hesaplari (tekrar kosmak guvenli, Go gerekir)
```
