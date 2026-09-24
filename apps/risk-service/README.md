# @getir/risk-service

Risk servisi: sipariş bağlamını puanlar ve bir **bant önerir**. Kararı uygulamaz; aksiyonlar
(kapıda ödeme, rezervasyon süresi, 403) `order-service/application/apply-risk-decision.ts`'te tek yerde.

## Bugünkü durum (T6.1 — kural motoru)

| Parça                          | Durum                                                                   |
| ------------------------------ | ----------------------------------------------------------------------- |
| Kural arayüzü + kayıt          | ✅ `domain/rule.ts`, `rules/registry.ts` (config ile iki yönlü eşleşme) |
| Skor, bant, veto               | ✅ `domain/score.ts`, `domain/bands.ts`                                 |
| Paralel koşu + hata izolasyonu | ✅ `application/evaluate-risk.ts` (kural başına 200 ms sınır)           |
| Config                         | ✅ `config/risk.rules.json` (Zod ile doğrulanır)                        |
| Altı çekirdek kural            | ⏳ T6.2                                                                 |
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

Roadmap "Test personaları" tablosu (Ayşe, Zeynep, Can, Ali, Komşu). Personaların kurallarla tablo
güdümlü testi T6.2'de, gerçek hesaplar T8.1 seed'inde.
