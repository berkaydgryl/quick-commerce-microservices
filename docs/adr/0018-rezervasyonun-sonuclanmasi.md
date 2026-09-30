# ADR-18: Rezervasyonun sonuclanmasi: once Redis'te sahiplik, sonra Mongo'da defter

- Durum: Kabul edildi
- Tarih: 2026-10-01

## Baglam

Rezervasyon Redis'te yasar (ADR-03): sayac dusumu, rezervasyon hash'i ve sure
indeksi. Sonuclanmasi (birakma; T10.2 PR 2'de onay, T10.3'te sure dolumu) ise iki
yere yazar: Redis'teki sayaclar geri artar (ya da onayda kalir) ve Mongo'daki stok
defterine (`stock_ledger`) kalici bir kayit duser. Iki ayri veri deposu tek atomik
adimda yazilamaz; aradaki her kopus ya stogu iki kez hareket ettirir ya da kaydi
kaybeder.

Ayrica ayni rezervasyonu uc yol ayni anda sonuclandirmak isteyebilir: kullanici
iptali, odeme onayi ve supurucu (B3, B4). Stok tam bir kez hareket etmelidir.

## Karar

1. **Once sahiplik (Redis).** Sonuclandiran Lua script'i ilk is olarak sure
   indeksindeki uyeyi siler (`ZREM resv:index:{market} orderId`); silen cagri isi
   yapar, digerleri cekilir (B3). Sayaclar ayni script'te hareket eder.
2. **Kayit silinmez, isaretlenir.** Script hash'i silmez; `state` (bu PR'da
   `released`), `reason` ve `settledAt` alanlarini yazar, adetler (`qty:{sku}`)
   hash'te kalir. Hash'in omru `SETTLED_RESERVATION_TTL_MS`'ye (24 saat) cekilir.
3. **Sonra defter (Mongo).** Servis defter kayitlarini yazar, BASARILI olunca izi
   (hash'i) siler.
4. **Yarida kalan tamamlanir.** Defter yazilamazsa (Mongo erisilemez) istek hata
   alir ama sayaclar zaten hareket etmistir. Ayni istegin tekrari script'ten
   "sonuclanmis" cevabini (izin adetleri, gerekcesi ve ani) alir, defteri onlarla
   tamamlar ve "zaten uygulandi" doner.
5. **Cift kayit olusmaz (B14).** Defter kaydinin `_id`'si dogal anahtardir
   (`siparis/sku/tur`); ayni hareket ikinci kez yazilirsa degismez ve hata vermez.
6. **Defter eldeki adedin hesabidir.** Seed her market x SKU icin bir acilis kaydi
   (+onHand) yazar; onay (PR 2) -adet yazar; birakma ve sure dolumu onHand'i
   degistirmez (delta 0, adet ayri alanda). Boylece delta toplami onHand'e esittir
   (T10.2 bitti tanimi). Iz silindikten sonra siparisin nasil sonuclandigi
   defterden okunur.

## Gerekce

Sira tersine donseydi (once Mongo, sonra Redis) supurucu ile yarista stok iki kez
hareket ederdi: defter "birakildi" derken supurucu da sayaci artirabilirdi (B3'e
aykiri). Hash'i hemen silmek ise Mongo o an erisilemezse adetleri kaybettirirdi:
tekrar gelen istek neyi yazacagini bilemez, defter eksik kalirdi. Izin 24 saatlik
omru yalnizca bu kesinti penceresini sinirlar; normal akista iz milisaniyeler icinde
silinir.

Alternatifler elendi: iki fazli yazim ya da dagitik transaction (Redis desteklemez);
defteri olayla (outbox) yazmak (inventory'de outbox yok ve kayit yine Redis'ten sonra
dogar, ayni pencere kalir); ayri bir "bekleyen kayit" anahtari (hash zaten adetleri
tasiyor, ikinci anahtar ayni bilgiyi kopyalar).

## Sonuclari

- Olumlu: stok her kosulda tam bir kez hareket eder; Mongo kesintisinde kayit
  kaybolmaz, tekrar gelen istek tamamlar. Tekrarlar guvenlidir (at-least-once).
- Olumsuz: iz dururken (normalde milisaniyeler, Mongo kesintisinde en cok 24 saat)
  ayni siparis kimligiyle gelen Reserve "zaten rezerve" cevabi alir; order ayni
  siparisi yeniden rezerve etmez (T11.2).
- Olumsuz: Mongo 24 saatten uzun erisilemez ve istek hic tekrarlanmazsa defterde o
  birakmanin kaydi eksik kalir (sayaclar yine dogrudur; eksik olan gecmistir).

## Ilgili

ADR-01 (atomik rezervasyon), ADR-03 (stok gercegi Mongo, sayac Redis), ADR-08
(idempotency), ADR-17 (sayac kumesinin isareti); gorev T10.2, B3, B4, B14.
