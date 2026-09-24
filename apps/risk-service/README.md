# @getir/risk-service

Risk servisi: sipariş bağlamını puanlar ve bir **bant önerir**. Kararı uygulamaz; aksiyonlar
(kapıda ödeme, rezervasyon süresi, 403) `order-service/application/apply-risk-decision.ts`'te tek yerde.

## Bugünkü durum (T6.2 — çekirdek kurallar)

| Parça                          | Durum                                                                   |
| ------------------------------ | ----------------------------------------------------------------------- |
| Kural arayüzü + kayıt          | ✅ `domain/rule.ts`, `rules/registry.ts` (config ile iki yönlü eşleşme) |
| Skor, bant, veto               | ✅ `domain/score.ts`, `domain/bands.ts`                                 |
| Paralel koşu + hata izolasyonu | ✅ `application/evaluate-risk.ts` (kural başına 200 ms sınır)           |
| Config                         | ✅ `config/risk.rules.json` (Zod ile doğrulanır)                        |
| Altı çekirdek kural            | ✅ `rules/*.rule.ts`, eşikler `config/constants.ts`                     |
| `Evaluate` RPC, `risk_events`  | ⏳ T6.3 (gRPC sunucusu da o görevde açılır)                             |

## Bantlar (T6.1 kararı)

| Skor   | Bant       | Aksiyon (order uygular)                           |
| ------ | ---------- | ------------------------------------------------- |
| 0-29   | `LOW`      | Kapıda ödeme açık, rezervasyon 10 dk              |
| 30-54  | `MEDIUM`   | Kapıda ödeme kapalı, kart + 3DS, rezervasyon 2 dk |
| 55-79  | `HIGH`     | REVIEW kuyruğu                                    |
| 80-100 | `CRITICAL` | 403 + geçici kara liste                           |

Eşikler yalnızca `domain/bands.ts`'te; proto bandın **adını** taşır. Eski eşiklerde (86+) ağırlık
toplamı tam 100 olduğundan kritik banda altı kuralın hepsi gerekiyordu; şimdi beşi ya da **veto**.

## Kesin kural (veto)

Bir kural `veto: true` isteyebilir, ama yalnızca config'te `"severity": "block"` olan kuralın isteği
dikkate alınır; diğerlerininki yok sayılır ve uyarı yazılır. Kural kendine engelleme yetkisi veremez.
Bugün yalnızca `ip-device` ("aynı cihazda 3+ hesap"). Veto skor ne olursa olsun `CRITICAL` verir ve
sonuçta `vetoedByRuleId` durur: "skor 45, ama cihazda 3+ hesap".

## Çekirdek kurallar (T6.2)

| Kural            | Tetiklenir (eşik dahil değil)                                   | Ağırlık |
| ---------------- | --------------------------------------------------------------- | ------- |
| `account-age`    | Hesap 24 saatten genç                                           | 20      |
| `order-history`  | Hiç teslimat yok **ya da** iptal oranı %50'nin üstünde          | 15      |
| `basket-anomaly` | Sepet ortalamanın 3 katından büyük (ortalama yoksa tetiklenmez) | 20      |
| `checkout-dwell` | Rezervasyondan siparişe 3 sn'den kısa (sunucuda ölçülür)        | 15      |
| `geofence`       | Teslimat ile oturum konumu arası 50 km'den fazla                | 15      |
| `ip-device`      | Cihazda 3+ hesap (**veto**) ya da IP önceki oturumdan farklı    | 15      |

- Bağlamda alan yoksa kural **tetiklenmez** (sözleşme: eksik sinyal 0 puan).
- **Gerekçelerde kişisel veri yok:** IP, cihaz kimliği ve koordinat `risk_events`'e yazılmaz; "cihazda 4 hesap",
  "oturum teslimat adresinden 351 km uzakta", "IP önceki oturumdan farklı" gibi.
- Eşikler ham değerle karşılaştırılır; yuvarlama yalnızca gerekçe metnindedir.

## Kural = dosya

Yeni kural: `rules/<id>.rule.ts` + `config/risk.rules.json`'a bir satır + `rules/index.ts`'e kayıt.
Motor değişmez. Kayıt açılışta iki yönü de doğrular: config'i olmayan kural ve kuralı olmayan config
satırı (yazım hatası) servisi başlatmaz.

Kural yalnızca `{ hit, reason, veto? }` döner; **ağırlık ve veto yetkisi config'ten** gelir.

## Dayanıklılık

- Kurallar **paralel** koşar.
- Hata veren, senkron fırlatan ya da **200 ms'de bitmeyen** kural 0 puan sayılır, uyarı yazılır;
  değerlendirme düşmez. Zamanlayıcı her durumda temizlenir.
- Tetiklenmeyen ve hata veren kural da sonuç listesinde durur (`reason: "kural hatasi"`): "kural koşmadı"
  ile "koştu ama tetiklenmedi" ayrılır.

## Test personaları

`test/support/personas.ts` + `test/unit/personas.spec.ts`: beş persona **gerçek** altı kural, gerçek config
ve gerçek eşiklerle değerlendirilir. Bir ağırlık, eşik ya da kural değişip bir persona bandından kayarsa test
kırmızı olur. Gerçek hesaplar T8.1 seed'inde, demo T15.1'de.

| Persona | Tetiklenen kurallar                                  | Skor      | Bant       |
| ------- | ---------------------------------------------------- | --------- | ---------- |
| Ayşe    | —                                                    | 0         | `LOW`      |
| Zeynep  | account-age, order-history                           | 35        | `MEDIUM`   |
| Can     | account-age, order-history, basket-anomaly, geofence | 70        | `HIGH`     |
| Ali     | checkout-dwell, geofence, ip-device (**veto**)       | 45 + veto | `CRITICAL` |
| Komşu   | —                                                    | 0         | `LOW`      |
