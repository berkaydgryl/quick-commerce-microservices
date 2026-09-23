# @getir/payment-service

Ödeme servisi (gRPC, :50054). Gerçek banka yok: çekim ve 3DS **mock**'tur. Buna rağmen sözleşme
gerçek bir sağlayıcı takılabilecek biçimde kuruldu: sağlayıcı bir port (`PaymentProvider`),
idempotency ve durum makinesi baştan yerinde.

## Bugünkü durum (T5.3 — kalıcılık ve deneme geçmişi)

| Uç                     | Durum                                                                           |
| ---------------------- | ------------------------------------------------------------------------------- |
| `Charge`               | ✅ Test kartına göre onay / ret / 3DS; kapıda ödeme `PENDING`                   |
| `Confirm3Ds`           | ✅ Sabit kod, 60 sn ömür, 3 yanlışta kilit, tekrar istek güvenli (T5.2)         |
| `payments`             | ✅ Mongo (`MOCK=false`) ya da bellek (`MOCK=true`); `attempts[]` geçmişi (T5.3) |
| `GetPayment`, `Refund` | ⏳ Sipariş zinciri görevlerinde                                                 |

## Test kartları

Servise kart numarası **gelmez**, yalnızca jeton gelir (`payment.proto`: "kart verisi bu
sözleşmeden geçmez"). İstemcideki demo sağlayıcı numarayı jetona çevirir (T12.4).

| Jeton           | Kart                  | Sonuç                                            |
| --------------- | --------------------- | ------------------------------------------------ |
| `tok_test_4242` | `4242 4242 4242 4242` | `SUCCEEDED`                                      |
| `tok_test_0002` | `4000 0000 0000 0002` | `FAILED` + `PAYMENT_DECLINED`                    |
| `tok_test_3184` | `4000 0027 6000 3184` | `REQUIRES_3DS` + `challenge_id` (`tds_…`, 60 sn) |
| başka her jeton | —                     | `FAILED` + `PAYMENT_DECLINED`                    |

**Kart reddi gRPC hatası değildir.** Cevap `status=FAILED`, `failure_code=PAYMENT_DECLINED` taşır:
red normal bir iş sonucudur, saga onu okuyup rezervasyonu bırakır.

## Charge akışı ve çift çekim koruması

1. Aynı `idempotency_key` ile kayıt varsa: aynı niyetse (sipariş, kullanıcı, tutar, yöntem) **ilk
   kayıt döner**, sağlayıcıya gidilmez; farklıysa `CONFLICT` (ABORTED).
2. Siparişin başka anahtarla bir ödemesi varsa `CONFLICT` (sipariş başına tek ödeme).
3. **Sağlayıcıdan önce** `PENDING` kayıt yazılır; sipariş ve anahtar sahiplenilir.
4. Kartsa sağlayıcıya gidilir, karar aynı kayda işlenir. Kapıda ödemede sağlayıcı yok, `PENDING`
   kalır (tutar teslimatta alınır).

Sıra kasıtlı: sağlayıcıya önce gidilseydi aynı anahtarla eşzamanlı iki istek **iki kez çekim**
yapabilirdi. Şimdi ikincisi 3. adımda çakışır, tekrar-istek yoluna düşer ve kazananın kaydını döner
(test: `charge.spec.ts` → "es zamanli ayni anahtar"). Sağlayıcıya ulaşılamazsa tutar çekilmemiştir;
kayıt `FAILED` + `SERVICE_UNAVAILABLE` olur, `PENDING`'de takılı kalmaz.

## Veri kaynağı: Mongo ya da MOCK

| `MOCK` | Depo                                            | Mongo gerekir mi                 |
| ------ | ----------------------------------------------- | -------------------------------- |
| `true` | Bellek (`infrastructure/memory`)                | Hayır; yeniden başlayınca unutur |
| değil  | `payments` koleksiyonu (`infrastructure/mongo`) | Evet, `MONGO_URI` zorunlu        |

İki depo **aynı sözleşme testinden** geçer (`test/support/payment-store-contract.ts`): birim testinde
bellek, entegrasyon testinde gerçek Mongo. Depoyu seçip açan tek yer `infrastructure/payment-store.ts`.

**İndeksler (koda bildirilir, açılışta kurulur):** `orderId` unique (sipariş başına tek ödeme) ve
`idempotencyKey` unique (aynı niyet iki kayıt açamaz). İkisi de hız için değil, **iş kuralı** için.

**İyimser kilit:** güncelleme `replaceOne({ _id, version: beklenen })`; eşleşme yoksa kayıt yok mu
(NOT_FOUND) sürüm mü değişmiş (CONFLICT) ayrılır.

**`attempts[]` denetim geçmişi:** ödemedeki her karar, eskiden yeniye:

| Adım      | Sonuçlar                                                       |
| --------- | -------------------------------------------------------------- |
| `CHARGE`  | `APPROVED`, `DECLINED`, `CHALLENGE_REQUIRED`, `PROVIDER_ERROR` |
| `THREEDS` | `CODE_ACCEPTED`, `CODE_REJECTED`, `EXPIRED`                    |

Durumu değiştirmeyen istekler (tekrar istek, biçimi bozuk kod, ulaşılamayan banka) kayıt eklemez.
Belgede kart jetonu ve girilen 3DS kodu **yoktur**. Kapıda ödemede geçmiş boştur (sağlayıcı yok).

## 3DS doğrulaması (Confirm3Ds)

Mock bankanın kabul ettiği kod `@getir/core` → `MOCK_THREEDS_CODE` (`123456`). Kodu domain değil
sağlayıcı doğrular (`PaymentProvider.verifyChallenge`).

| Girdi                               | Ödeme                      | Cevap                                                                 |
| ----------------------------------- | -------------------------- | --------------------------------------------------------------------- |
| Doğru kod                           | `REQUIRES_3DS → SUCCEEDED` | ödeme kaydı                                                           |
| 1. / 2. yanlış kod                  | `REQUIRES_3DS` kalır       | `THREEDS_FAILED`, `{ attemptsLeft: 2/1, reason: "wrong_code" }`       |
| 3. yanlış kod                       | `→ FAILED`, jeton kilitli  | `THREEDS_FAILED`, `{ attemptsLeft: 0, reason: "attempts_exhausted" }` |
| 60 sn doldu (kod bakılmaz)          | `→ FAILED`                 | `THREEDS_FAILED`, `{ attemptsLeft: 0, reason: "expired" }`            |
| Bilinmeyen / başka siparişin jetonu | değişmez                   | `NOT_FOUND`                                                           |
| Sonuçlanmış ödemeye tekrar          | değişmez                   | önceki sonuç (başarı ya da aynı sebeple ret)                          |
| Biçimi bozuk kod (`12ab`)           | değişmez, **hak düşmez**   | `VALIDATION_FAILED`                                                   |
| Bankaya ulaşılamadı                 | değişmez, **hak düşmez**   | `SERVICE_UNAVAILABLE`                                                 |

**Eşzamanlı denemeler:** ödeme kaydında `version` (iyimser kilit) var. Aynı jetona aynı anda iki yanlış
kod gelirse ikinci yazma çakışır, kayıt yeniden okunur ve kural güncel sayaçla uygulanır: iki deneme
iki hak yakar, tek değil. Bankaya istek başına bir kez gidilir; kodun doğruluğu kaydın durumuna bağlı
değildir.

## Katmanlar

```text
src/
  domain/          payment.ts (durumlar, geçişler), three-ds.ts (3DS kuralları), portlar
  application/     charge.ts, confirm-3ds.ts
  infrastructure/  memory/ ve mongo/ (depo), payment-store.ts (mod seçimi), mock-provider/
  interfaces/grpc/ şema (Zod), eşleme (Record), handler
  config/          env.ts, constants.ts (THREEDS_CHALLENGE_TTL_MS = 60 000, THREEDS_MAX_ATTEMPTS = 3)
```

## Çalıştırma ve doğrulama

```bash
pnpm --filter @getir/payment-service build && pnpm --filter @getir/payment-service start   # :50054 (kok .env: MOCK, MONGO_URI)
pnpm test:int   # gercek Mongo (Testcontainers): sozlesme, indeksler, yeniden baslatma

grpcurl -plaintext -import-path packages/proto/proto -proto getir/payment/v1/payment.proto \
  -d '{"orderId":"ord_a","userId":"usr_1","amount":{"amountMinor":12990,"currency":"TRY"},
       "method":"PAYMENT_METHOD_CARD","cardToken":"tok_test_4242","idempotencyKey":"anahtar-ord_a"}' \
  localhost:50054 getir.payment.v1.PaymentService/Charge
```

## Docker

```bash
docker build -f apps/payment-service/Dockerfile -t getir/payment-service .   # baglam depo koku
docker run --rm -p 50054:50054 getir/payment-service
```
