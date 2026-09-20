# ADR-01: Sicak yolda stok dusumu Redlock ile degil tek Lua script'i ile yapilir

- Durum: Kabul edildi
- Tarih: 2026-09-20

## Baglam

Sepete ekleme ve siparis onayi sirasinda ayni dark store + SKU cifti icin es zamanli
istekler gelir. Asiri satis (oversell) kabul edilemez bir hatadir: musteriye satilan
urun depoda yoktur. Korunmasi gereken bolge tek bir islem degildir; mevcut sayacin
kontrolu, sayacin dusurulmesi, rezervasyon kaydinin yazilmasi ve rezervasyonun
resv:index ZSET'ine eklenmesi ya hep birlikte ya da hic gerceklesmelidir. Iki aday
vardi: istemci tarafinda dagitik kilit (Redlock) ile bu bolgeyi korumak, ya da tum
adimi sunucu tarafinda tek bir Lua script'i olarak calistirmak.

## Karar

Sicak yoldaki stok dusumu ve rezervasyon olusturma TEK bir Lua script'i ile yapilir.
Script; kontrol, dusum, rezervasyon kaydi ve ZSET indeks yazimini tek atomik adimda
yurutur ve karar sonucunu (basarili / yetersiz stok) dondurur. Redlock sicak yolda
KULLANILMAZ. Redlock yalnizca supurucu (sweeper) ve reconciliation islerinin liderlik
secimi icin kullanilir; bunlar seyrek calisan, uzun suren ve tek calisani yeterli olan
arka plan isleridir.

## Gerekce

Redis komut yurutmesi tek thread'lidir ve EVAL suresince araya baska komut giremez;
yani Lua zaten karsilikli dislama saglar. Kilidin ustune kilit koymak ek guvenlik
getirmez, maliyet getirir: Redlock en az bir tur kilit alma ve bir tur birakma gecikmesi
ekler, saat kaymasi ve uzun GC duraklamalari altinda guvenlik varsayimlari tartismalidir,
ve kilit sahibi coktugunde stok kilit suresi boyunca satilamaz kalir. Elenen diger
alternatifler: WATCH/MULTI ile iyimser eszamanlilik, cekisme altinda yeniden deneme
firtinasina donusur; stok dusumunu Mongo transaction'ina tasimak ise sicak yola replica
set gecikmesi ekler ve saniyedeki istek tavanini dusurur.

## Sonuclari

- Olumlu: tek gidis-donus, deterministik sonuc, oversell'e karsi kesin garanti; hata
  ayiklamada "kim kilidi birakmadi" sinifindan sorun hic olusmaz.
- Olumsuz: script kisa ve O(1) tutulmak zorundadir, cunku uzun script tum Redis'i
  bloklar. Birden fazla anahtara dokundugu icin anahtarlar ayni hash slot'unda olmalidir
  (store bazli hash tag). Lua'yi test etmek ve gozlemlemek TypeScript koduna gore zordur.
- Kabul edilen borc: script'ler dosyada versiyonlanir ve EVALSHA ile cagrilir; eski
  script ile yeni istemcinin ayni anda calisabilecegi gecis penceresi tek ortamli demo
  oldugu icin gozardi edilir.

## Ilgili

ADR-02, ADR-03, ADR-08; gorev T1.5.
