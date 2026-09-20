# docs/

Projenin yazılı belleği. Kod nasıl çalıştığını, bu klasör **neden öyle olduğunu**
anlatır.

## Harita

| Yol                        | İçerik                                                                                                                                                  |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`roadmap.md`](roadmap.md) | 20 günlük yol haritası: fazlar, görev kimlikleri (T1.1, T19.1 ...) ve teslim ölçütleri. Günlük çalışmanın başladığı yer.                                |
| [`adr/`](adr/)             | Mimari karar kayıtları (Architecture Decision Record). Geri dönülmesi pahalı her karar burada numaralı bir dosyadır.                                    |
| [`api/`](api/)             | Dışa açılan sözleşmeler: REST (`openapi.yaml`), Socket.io (`socket-events.md`) ve bunların nasıl üretildiğini anlatan [`api/README.md`](api/README.md). |

## Ne nereye yazılır

- **Bir karar aldın ve geri dönmek pahalı olacak** (veri deposu seçimi, saga mı
  2PC mi, rezervasyonun Redis'te tutulması, para biriminin kuruş tam sayısı
  olması) → `adr/` altına yeni bir ADR.
- **Dışarıdan çağrılan bir yüzey değişti** (yeni uç, yeni alan, yeni hata kodu,
  yeni soket olayı) → `api/` altındaki ilgili sözleşme.
- **Sıradaki iş değişti** (görev eklendi, gün kaydı) → `roadmap.md`.
- **Servisler arası gRPC sözleşmesi** → burada değil, `packages/proto` altındaki
  `.proto` dosyalarında; `buf` bunları CI'da doğrular.
- **Kurulum ve demo adımları** → kök [`../README.md`](../README.md).

## ADR yazım kuralı

Dosya adı `NNNN-kisa-baslik.md` (örn. `0003-rezervasyon-redis-ttl.md`), içerik
şu başlıklardan oluşur: **Durum** (`Önerildi` / `Kabul edildi` /
`Yerini aldı: NNNN`), **Tarih**, **Bağlam**, **Karar**, **Gerekçe**,
**Sonuçları** (olumlu / olumsuz / kabul edilen borç) ve **İlgili** (diğer
ADR'ler, görev kimlikleri). Kabul edilmiş bir ADR
silinmez veya geçmişe dönük düzeltilmez; yerine yenisi yazılır ve eskisinin
durumu güncellenir — kararın neden değiştiği de kayıt altında kalır.
