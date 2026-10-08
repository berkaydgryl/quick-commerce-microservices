# @getir/payment-service

Ödeme servisi (gRPC, :50054). Gerçek banka yok: çekim ve 3DS **mock**'tur. Buna rağmen sözleşme
gerçek bir sağlayıcı takılabilecek biçimde kuruldu: sağlayıcı bir port (`PaymentProvider`),
idempotency ve durum makinesi baştan yerinde. Aynı sunucuda ikinci servis **kart kasasıdır**
(`getir.cardvault.v1.CardVaultService`, T11.17): kullanıcının kayıtlı kartları, maskeli.

## Bugünkü durum (T7.4 — iade komutu tüketicisi)

| Uç                         | Durum                                                                                                                                                                                         |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Charge`                   | ✅ Test kartına göre onay / ret / 3DS; kayıtlı kart `card_id` (T12.4); kapıda ödeme `PENDING`; risk 3DS (T7.1)                                                                                |
| `Confirm3Ds`               | ✅ Sabit kod, 60 sn ömür, 3 yanlışta kilit, tekrar istek güvenli (T5.2)                                                                                                                       |
| `payments`                 | ✅ Mongo (`MOCK=false`) ya da bellek (`MOCK=true`); `attempts[]` geçmişi (T5.3)                                                                                                               |
| `Refund`                   | ✅ Saga'nın telafisi (T7.1): yalnızca tamamlanmış çekim; tekrar istek `already_refunded`                                                                                                      |
| `payment.refund_requested` | ✅ Olay tüketicisi (T7.4): saga'nın kalıcı iade komutu `stream:events`'ten, grup `payment`                                                                                                    |
| `payment.cancel_requested` | ✅ Olay tüketicisi (T11.2 PR 3): tahsil edilmemiş ödeme `CANCELLED`, alınmışsa iade (T15.3)                                                                                                   |
| `GetPayment`               | ✅ Siparişin ödeme kaydı (yöntem, durum) ve 3DS durumu (`three_ds`, #163 B1); kayıt yoksa `NOT_FOUND`. Çağıran order: iptal ve süpürücü; sipariş ayrıntısı (#163 B1 P3) 3DS durumunu okuyacak |
| `CardVaultService`         | ✅ Kart kasası (T11.17): `AddCard` (0 TL doğrulama), `ListCards`, `DeleteCard`; maskeli, en çok 10 kart                                                                                       |

## Test kartları

Çekime (`Charge`) kart numarası **gelmez**, yalnızca jeton gelir (`payment.proto`: "kart verisi
bu sözleşmeden geçmez"). Numara yalnızca kart kasasının `AddCard`'ında bir kez geçer: mock
sağlayıcı numarayı bu tablodan tanır ve kasaya karşılığı olan jeton yazılır (T11.17).

**Kart üretici numaraları (bekleyen iş 112):** tablodaki kartlar kendi kararını alır. Dışındaki her
kart Luhn'dan geçiyor ve markası desteklenen (Visa, Mastercard, Amex, Troy) ise **onaylanır**. Kart,
numaradan türetilmeyen rastgele bir jeton alır (`tok_<32 onaltılık>`) ve çekimde bu biçimdeki jeton
onaylanır. Kural durumsuzdur: payment yeniden başlasa da kasadaki kart çekilir. Desteklenmeyen
marka (Discover, JCB…) sağlayıcıya gitmeden `VALIDATION_FAILED` alır ("Bu kart türü
desteklenmiyor"); son kullanma tarihi geçmiş kart da öyle.

> **Uyarı:** bu kural yalnızca mock sağlayıcıdadır (`infrastructure/mock-provider`), ortam bayrağı
> yoktur. Bugün `bootstrap.ts` her ortamda mock'u bağlar; gerçek sağlayıcı geldiğinde orada o
> bağlanmalı ve mock hiçbir ortamda kalmamalıdır (aksi halde üretilmiş her kart onaylanır).

| Jeton           | Kart                  | `Charge` sonucu                                  | Kasa (`AddCard`)         |
| --------------- | --------------------- | ------------------------------------------------ | ------------------------ |
| `tok_test_4242` | `4242 4242 4242 4242` | `SUCCEEDED`                                      | kaydedilir (Visa)        |
| `tok_test_0002` | `4000 0000 0000 0002` | `FAILED` + `PAYMENT_DECLINED`                    | `PAYMENT_DECLINED`       |
| `tok_test_3184` | `4000 0027 6000 3184` | `REQUIRES_3DS` + `challenge_id` (`tds_…`, 60 sn) | kaydedilir (3DS ödemede) |
| `tok_test_4444` | `5555 5555 5555 4444` | `SUCCEEDED`                                      | kaydedilir (Mastercard)  |
| `tok_test_0005` | `3782 822463 10005`   | `SUCCEEDED`                                      | kaydedilir (Amex, CVV 4) |
| `tok_test_0003` | `9792 0000 0000 0003` | `SUCCEEDED`                                      | kaydedilir (Troy)        |
| `tok_test_8431` | `3714 496353 98431`   | `FAILED` + `PAYMENT_DECLINED`                    | `PAYMENT_DECLINED`       |
| `tok_<32 hex>`  | başka geçerli kart    | `SUCCEEDED`                                      | kaydedilir (üretilmiş)   |
| başka her jeton | —                     | `FAILED` + `PAYMENT_DECLINED`                    | —                        |

**Risk 3DS isteyebilir (T7.1):** `require_three_ds = true` gelirse (order-svc orta risk bandında
doldurur) bankanın onaylayacağı kart da `REQUIRES_3DS` döner; reddedilecek kart yine reddedilir.
Bayrak çekim **niyetinin** parçası değil, politikadır: tekrar-istek karşılaştırmasına girmez,
kayda yazılmaz, etkisi karar ve `attempts[]` geçmişinde görünür. Kapıda ödemede
`VALIDATION_FAILED`.

**Kart reddi gRPC hatası değildir.** Cevap `status=FAILED`, `failure_code=PAYMENT_DECLINED` taşır:
red normal bir iş sonucudur, saga onu okuyup rezervasyonu bırakır.

## Kart kasası (CardVaultService, T11.17)

Sözleşme `packages/proto/proto/getir/cardvault/v1/card_vault.proto`; kart kuralları (Luhn, marka,
CVV, son kullanma, ad ve kart adı) `@getir/contracts` `cards.ts`'te — web ile kasa **aynı
fonksiyonları** kullanır. `user_id` gateway'den gelir (erişim jetonunun `sub`'ı).

**`AddCard` akışı:** (1) şema: biçim, Luhn, marka, CVV uzunluğu, ad ve kart adı (NFC, kırpılmış);
(2) son kullanma: geçmemiş ve en çok 20 yıl ileri (Türkiye saatiyle); (3) kasa dolu mu, aynı kart
var mı — **sağlayıcıya gitmeden**; (4) sağlayıcının 0 TL doğrulaması (`CardVerifier.verifyCard`):
`APPROVED` ve `CHALLENGE_REQUIRED` kaydedilir, `DECLINED` kaydedilmez; (5) maskeli kart depoya,
depo (3)'ü **atomik** olarak yeniden denetler.

| Durum                                    | Cevap                                                                |
| ---------------------------------------- | -------------------------------------------------------------------- |
| Biçim, Luhn, marka, CVV, ad, kart adı    | `VALIDATION_FAILED`, alan → cümle (`CARD_FIELD_MESSAGES`, değer yok) |
| Son kullanma geçmiş / çok ileri          | `VALIDATION_FAILED`, `expiryMonth` / `expiryYear`                    |
| Kasa dolu (10 kart)                      | `VALIDATION_FAILED`, `details.cards`                                 |
| Aynı kart (ilk 4 + son 4 + son kullanma) | `CONFLICT`, `details.cardId` kullanıcının kendi kartı                |
| Sağlayıcı reddetti                       | `PAYMENT_DECLINED`, `details.reason = verification_declined`         |
| Sağlayıcıya ulaşılamadı                  | `SERVICE_UNAVAILABLE` (asıl hatanın yalnızca türü günlükte)          |
| `DeleteCard`: yok, başkasının, silinmiş  | `NOT_FOUND` (üçü dışarıdan ayırt edilemez)                           |

**`UpdateCardNickname` (#148):** yalnızca kart adı değişir (numara, son kullanma, CVV değişmez; yeni
kart için sil + ekle). Kurallar eklemeyle aynı (`@getir/contracts` `updateCardNicknameRequestSchema`):
NFC + kırpma, NFC'den sonra en çok 30 karakter, ayraçlar atılınca 8+ ardışık rakam yok. Proto alanı
`optional`: gönderilmeyen ad boş metin değil **eksik** gelir ve `VALIDATION_FAILED` "Kart adı
gönderilmedi" ile reddedilir (ad değişmez); boş metin adı **kaldırır** (içeride açık `null`; depo boş
ad yazmaz). Kart yok,
başkasının ya da silinmiş: `NOT_FOUND` (ayırt edilemez). Süresi geçmiş kartın adı da değişir. Tek atomik
adım (`findOneAndUpdate` `{ _id, userId, status: ACTIVE }`, `$set` / `$unset`): eşzamanlı silmeyle
yarışta silinmiş kart düzenlenmez, düzenleme silinmiş kartı diriltmez (sözleşme testi). Cevap güncel
maskeli kart; günlükte yalnızca `userId`, `cardId` ve `removed` (ad değeri yok, testli).

**Mongo:** `cards` (`_id` `crd_…`; `userId`, `brand`, `first4`, `last4`, son kullanma, ad, kart adı,
`providerToken`, `status` `ACTIVE|DELETED`, `createdAt`, `deletedAt`) ve `card_wallets` (kullanıcı
başına `count`). Tam numara ve CVV **hiçbir alanda yok**. İndeksler: liste için
`{ userId, status, createdAt: -1, _id: -1 }`; aynı kart için `{ userId, first4, last4, expiryMonth,
expiryYear }` **kısmi unique** (`status: ACTIVE`; silinen kart yeniden eklenebilir).

**Neden sayaç (`card_wallets`):** transaction içinde "aktif kartları say, sonra ekle" yetmez. Anlık
görüntü yalıtımında eşzamanlı iki ekleme ikisi de 9 sayar ve farklı belgeler yazar; çakışma olmaz,
kasa 11 olur (write skew). Ekleme tek transaction'da: aynı kart var mı → sayacı hazırla
(`$setOnInsert`) → `count < 10` ise `$inc` → kart. İki ekleme aynı sayaç belgesine yazınca yazma
çakışması doğar, sürücü kaybedeni yeniden dener ve kazananın kartını görür. Silme: `DELETED`,
`deletedAt`, `providerToken` alanı **kaldırılır**, sayaç `-1`. `card_wallets` açılışta yoksa
oluşturulur (transaction içinde örtük oluşturmaya bırakılmaz). Göç yok: yeni koleksiyonlar.

**Günlük ve iz:** handler istek nesnesini günlüğe **hiç vermez**; satırlar yalnızca `userId`,
`cardId` ve `brand` taşır (ad ve kart adı da yok). İkinci emniyet ortak günlükçüde
(`@getir/observability` `redact.ts`): `cvv` her zaman, `number` yalnızca kart numarasına
benziyorsa gizlenir. Gizleme yalnızca **anahtar adına ve bilinen yollara** bakar (`cvv`, `number`,
`card.*`, `input.*`, `request.*`; joker yok, QA O1): başka biçimde verilen kart verisini yakalamaz,
asıl kural isteğin günlüğe hiç verilmemesidir. Sağlayıcı hatası `cause`'a konmaz: pino `cause`
mesajını satıra yazar. Sunucu span'inde yalnızca rpc nitelikleri vardır (testli:
`card-vault-logs.spec.ts`, `card-vault-tracing.spec.ts`). Testlerde kısa sır (CVV) günlük ya da
iz metninde aranmadan önce `@getir/core/testing` `withoutRandomNoise`'dan geçer: rastgele kimlik
(`req_…`) içinde tesadüfen geçebilir; kart numarası gibi genel rakam dizileri maskelenmez.

## Charge akışı ve çift çekim koruması

1. Aynı `idempotency_key` ile kayıt varsa: aynı niyetse (sipariş, kullanıcı, tutar, yöntem) **ilk
   kayıt döner**, sağlayıcıya gidilmez; farklıysa `CONFLICT` (ABORTED). Kart niyete girmez: kart
   sonradan silinmiş olsa da ilk kayıt döner, kart aranmaz.
2. Siparişin başka anahtarla bir ödemesi varsa `CONFLICT` (sipariş başına tek ödeme).
3. **Kayıtlı kart (T12.4, `card_id`):** kart kasada aranır (`application/charge-card.ts`): çağrının
   doğrulanmış kullanıcısına (`user_id`; order onu gateway'in doğruladığı oturumdan alır) ait ve
   `ACTIVE` olmalı. Değilse (silinmiş, başkasının, hiç olmamış) `NOT_FOUND`, ayrıntıda yalnızca
   `resource: card` (kimlik yankılanmaz) ve **hiçbir kayıt yazılmaz**: anahtar harcanmaz, aynı sipariş
   başka kartla yeniden çekilebilir. `card_id` ile eski `card_token` birlikte gelirse
   `VALIDATION_FAILED`. Sağlayıcı jetonu yalnız bellekte: cevaba, günlüğe ve kayda girmez (kayıtta
   yalnız `cardId`); sağlayıcı hatasının metni de günlüğe jetonsuz yazılır.
4. **Sağlayıcıdan önce** `PENDING` kayıt yazılır; sipariş ve anahtar sahiplenilir.
5. Kartsa sağlayıcıya gidilir, karar aynı kayda işlenir. Kapıda ödemede sağlayıcı yok, `PENDING`
   kalır (tutar teslimatta alınır). 3DS istenirse cevapta `challenge_expires_at` (çekim + 60 sn,
   payment'ın saati; tekrar istekte ilk çekiminki).

Kart arama ile çekim arasında kart silinirse çekim okunan jetonla sürer: kullanıcı ödemeyi silmeden
önce başlattı; silme (`ACTIVE` → `DELETED`, jeton belgeden kaldırılır) yalnız sonraki ödemeleri
engeller.

Sıra kasıtlı: sağlayıcıya önce gidilseydi aynı anahtarla eşzamanlı iki istek **iki kez çekim**
yapabilirdi. Şimdi ikincisi 4. adımda çakışır, tekrar-istek yoluna düşer ve kazananın kaydını döner
(test: `charge.spec.ts` → "es zamanli ayni anahtar"). Sağlayıcıya ulaşılamazsa tutar çekilmemiştir;
kayıt `FAILED` + `SERVICE_UNAVAILABLE` olur, `PENDING`'de takılı kalmaz.

## İade (Refund, T7.1)

Sipariş saga'sının telafisi: çekim başarılı oldu ama sipariş `PAID` yazılamadı (örneğin kullanıcı
aynı anda iptal etti). Siparişin tek ödemesi vardır, iade sipariş kimliğiyle bulunur.

| Ödeme durumu                        | Sonuç                                                             |
| ----------------------------------- | ----------------------------------------------------------------- |
| `SUCCEEDED`                         | `REFUNDED`; gerekçe (`refundReason`) ve `REFUND` denemesi yazılır |
| `REFUNDED`                          | aynı kayıt, `already_refunded = true` (tekrar istek)              |
| `PENDING`, `REQUIRES_3DS`, `FAILED` | `CONFLICT`: geri verilecek tutar yok                              |
| ödeme yok                           | `NOT_FOUND`                                                       |

Eş zamanlı iki iade: biri yazar, diğeri sürüm çakışmasında kaydı yeniden okur ve "zaten iade
edildi" döner — para iki kez geri verilmez. Gerekçe bir anahtardır (`order_changed_during_payment`),
Idempotency-Key zorunludur (ADR-08); tekrar koruması kaydın durumundadır.

## İade komutu (`payment.refund_requested`, T7.4)

Sipariş saga'sı tutarı aldı ama siparişi `PAID` yazamadı ve doğrudan `Refund` çağrısı da başarısız
oldu (T7.1); order komutu outbox'a yazdı (T7.3). Payment bu komutu `stream:events`'ten **`payment`
tüketici grubuyla** dinler (`@getir/event-bus`, `interfaces/workers/refund-requested.ts`) ve aynı
`Refund` use-case'ini çalıştırır. Gövde şeması `@getir/contracts` `events.ts`'tedir: order o
tipten kurar, payment aynı şemadan geçirir. Gerekçe ve anahtar kuralı `Refund` RPC'siyle ortaktır.

| Durum                                                                                            | Sonuç                                                                                 |
| ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------- |
| Tamamlanmış çekim                                                                                | `REFUNDED`; olay onaylanır (INFO)                                                     |
| Zaten iade edilmiş (komut tekrar geldi)                                                          | değişmez, ikinci iade yok; olay onaylanır (INFO)                                      |
| Gövde sözleşmeye uymuyor · ödeme yok · iade edilemez durum (`PENDING`, `REQUIRES_3DS`, `FAILED`) | **ret**: beklemeden `stream:events:dead`, ERROR                                       |
| Geçici hata (veritabanı kapalı, sürüm çakışması)                                                 | onaylanmaz; 30 sn sonra yeniden, en fazla 5 deneme; sonra `stream:events:dead`, ERROR |

- **İade edilemez ile sürüm çakışması ayrı:** ikisinin de kodu `CONFLICT` (RPC sözleşmesi
  değişmedi) ama iade edilemez durum `PaymentNotRefundableError` tipindedir ve tekrar denenmez;
  sürüm çakışması denenince geçer.
- **Grup ilk kez akışın başından okur:** payment kapalıyken bırakılan komut açılışta işlenir
  (28 Eylül kararı). Payment'ın kopyaları aynı gruptadır; bir komutu yalnızca biri işler.
- **Tüketici adı** `<makine>-<pid>`; zarif kapanışta bekleyen kaydı yoksa gruptan silinir.
- **İz ve `requestId` (D16):** komutun zarfı order'daki isteğin `requestId`'sini ve iz bağlamını
  taşır. İşleme bir span'dir (`process payment.refund_requested`), siparişi veren isteğin izinde;
  `iade komutu: ...` satırı aynı `requestId`'yi ve `traceId`'yi taşır (`@getir/event-bus` README).
- **Metrikler (T10.5, #12):** `localhost:51054/metrics`'te grubun sonuç sayacı
  (`event_consumer_events_total{group="payment",…}`), gecikmesi (`event_consumer_lag`) ve onaylanmamış
  kayıtları (`event_consumer_pending`). Tanımları `@getir/event-bus` README'sinde.
- `MOCK=true` iken dinleme **kapalıdır** (Redis yok).

## İptal komutu (`payment.cancel_requested`, T11.2 PR 3)

Sipariş ödeme aşamasından (`AWAITING_PAYMENT` ya da `PAID`) `CANCELLED`'a geçince order, siparişi
iptal eden yazımla **aynı transaction'da** bu komutu outbox'a yazar (kullanıcı iptali, süpürücü,
kilidi düşmüş ödeme). Order ödeme yöntemini bilmez; kararı payment verir
(`domain/cancel.ts`, `application/cancel-payment.ts`, `interfaces/workers/cancel-requested.ts`).
Grup ve teslim kuralları iade komutuyla aynı (`payment` grubu, en az bir kez).

| Ödeme kaydı                                            | Sonuç                                                                         |
| ------------------------------------------------------ | ----------------------------------------------------------------------------- |
| Kapıda ödeme `PENDING` · 3DS bekleyen (`REQUIRES_3DS`) | `CANCELLED` + `cancelReason` (`order_cancelled`), geçmişe `CANCEL`; onaylanır |
| Zaten `CANCELLED` (komut tekrar geldi)                 | değişmez; onaylanır                                                           |
| `SUCCEEDED` (para alınmış; T15.3, iş 134)              | **iade** (`refundReason` `order_cancelled`, geçmişe `REFUND`); onaylanır      |
| `REFUNDED` · `FAILED` · kayıt yok                      | dokunulmaz; onaylanır                                                         |
| Kart çekimi hâlâ `PENDING`                             | onaylanmaz (`REQUEST_IN_PROGRESS`); 30 sn sonra yeniden                       |
| Gövde sözleşmeye uymuyor                               | **ret**: beklemeden `stream:events:dead`                                      |
| Geçici hata (veritabanı kapalı, sürüm çakışması)       | onaylanmaz; yeniden denenir (sürüm çakışmasında önce bir kez yeniden okunur)  |

- **`CANCELLED` yeni durum** (proto `PAYMENT_STATUS_CANCELLED = 6`, ekleme): "tahsil edilmeden
  kapatıldı", para hiç alınmadı. İade edilmiş (`REFUNDED`) ödemeden ayrıdır. İptal edilmiş ödemenin
  3DS'i onaylanamaz (`Confirm3Ds` → `NOT_FOUND`), iadesi de yoktur (`Refund` → `CONFLICT`).
- **Alınmış paranın iadesi (T15.3, bekleyen iş 134):** `CANCELLED` siparişin son durumudur; komut
  geldiyse sipariş bir daha ödenmez ve teslim edilmez, tutar `Refund` use-case'iyle iade edilir. Örnek:
  3DS onayı payment'ta başarılı olurken kullanıcı iptal etti, onay cevabı order'a ulaşmadı. Order'ın
  kendi iadesiyle (doğrudan `Refund`, `payment.refund_requested`) çakışırsa ikincisi "zaten iade
  edilmiş" görür: para bir kez döner. İade de mock'tur: sağlayıcıya çağrı gitmez, kayıt `REFUNDED`
  olur. Kapıda ödeme bugün hiç `SUCCEEDED` olmaz (teslimde tahsilat kaydı yok; `PENDING` kalır ve
  iptalde `CANCELLED` olur), bu yol yalnız kartta işler. İade sürekli hata verirse komut en çok 5 kez
  teslim edilir (`@getir/event-bus` `maxDeliveries`; 4 yeniden teslim), sonra `stream:events:dead`'e taşınır, ERROR
  yazılır ve `event_consumer_events_total{outcome="dead"}` artar. WARN satırında yalnız `orderId`,
  sonuç ve durum vardır; tutar ve kart yok.
- `MOCK=true` iken dinleme kapalıdır (Redis yok); order da MOCK'ta olay yayınlamaz.

## Veri kaynağı: Mongo ya da MOCK

| `MOCK` | Depo                                                         | Mongo / Redis gerekir mi                                                                                     |
| ------ | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| `true` | Bellek (`infrastructure/memory`)                             | Hayır; yeniden başlayınca unutur, olay dinleme kapalı                                                        |
| değil  | `payments`, `cards`, `card_wallets` (`infrastructure/mongo`) | Evet: `PAYMENT_MONGO_URI` (kendi veritabanı `getir_payment`, D14) ve `REDIS_URL` (iade komutu, T7.4) zorunlu |

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

**Sipariş ayrıntısındaki durum (`GetPayment.three_ds`, #163 B1):** sayfa yenilense de doğrulama
sürdürülsün diye order bunu sipariş ayrıntısına taşır (`domain/three-ds-status.ts`).

- Var: ödeme `REQUIRES_3DS` (açık ya da süresi dolmuş, henüz kapatılmamış) ya da doğrulaması kapanıp
  `FAILED` olmuş. Yok: doğrulama hiç yok, ödeme başarılı/iade/iptal ya da kart reddiyle `FAILED`.
- `challenge_id` yalnızca doğrulama **açıkken** (süresi payment'in saatiyle dolmamış, hak var) dolu;
  kapalıda boş metin. `expires_at` her zaman. `attempts_left` = en fazla hak − yanlış kod, kapanma
  sebebinden bağımsız (Confirm3Ds hata ayrıntısındaki `expired → 0` ile karışmasın: o cevap kapanışı anlatır).
- **Güvenlik:** jeton bir yetenek jetonudur (oturumla kod girmeye yeter); hiçbir günlükte, hata
  ayrıntısında ya da metrikte yok (testli). Kod (OTP) hiçbir kayıtta tutulmaz.

## Katmanlar

```text
src/
  domain/          payment.ts (sözlük + Payment + withAttempt), charge.ts (çekim), three-ds.ts (3DS), refund.ts (iade), portlar
                   card.ts (maskeli kart), card-errors.ts, card-repository.ts ve card-verifier.ts (kart kasası portları)
  application/     charge.ts, confirm-3ds.ts, refund.ts; add-card.ts, list-cards.ts, delete-card.ts
  infrastructure/  memory/ ve mongo/ (depo), payment-store.ts (mod seçimi), mock-provider/
  interfaces/grpc/ şema (Zod), eşleme (Record), handler
  interfaces/workers/ refund-requested.ts (iade komutu işleyicisi, T7.4); kayıt bootstrap.ts subscribePaymentEvents
  config/          env.ts, constants.ts (THREEDS_CHALLENGE_TTL_MS = 60 000, THREEDS_MAX_ATTEMPTS = 3, EVENT_CONSUMER_GROUP)
```

## Çalıştırma ve doğrulama

```bash
pnpm --filter @getir/payment-service build && pnpm --filter @getir/payment-service start   # :50054 (kok .env: MOCK, PAYMENT_MONGO_URI, REDIS_URL)
pnpm test:int   # gercek Mongo + Redis (Testcontainers): sozlesme, indeksler, yeniden baslatma, iade komutu uctan uca

redis-cli XINFO GROUPS stream:events             # payment grubu: pending ve lag 0 olmali
redis-cli XRANGE stream:events:dead - +          # islenemeyen komutlar (gerekce, deneme sayisi)

grpcurl -plaintext -import-path packages/proto/proto -proto getir/payment/v1/payment.proto \
  -d '{"orderId":"ord_a","userId":"usr_1","amount":{"amountMinor":12990,"currency":"TRY"},
       "method":"PAYMENT_METHOD_CARD","cardToken":"tok_test_4242","idempotencyKey":"anahtar-ord_a"}' \
  localhost:50054 getir.payment.v1.PaymentService/Charge

grpcurl -plaintext -import-path packages/proto/proto -proto getir/cardvault/v1/card_vault.proto \
  -d '{"userId":"usr_1","number":"5555 5555 5555 4444","expiryMonth":12,"expiryYear":2031,
       "cvv":"123","holderName":"Ayse Yilmaz","nickname":"Maas karti"}' \
  localhost:50054 getir.cardvault.v1.CardVaultService/AddCard
```

## Docker

```bash
docker build -f apps/payment-service/Dockerfile -t getir/payment-service .   # baglam depo koku
docker run --rm -p 50054:50054 -e MOCK=true getir/payment-service   # MOCK'suz: PAYMENT_MONGO_URI + REDIS_URL zorunlu
node scripts/check-node-image.mjs getir/payment-service   # imaj denetimi (D12), CI'da da kosar
```
