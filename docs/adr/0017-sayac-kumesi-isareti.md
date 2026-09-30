# ADR-17: Stok sayac kumesinin isareti TTL'sizdir

- Durum: Kabul edildi
- Tarih: 2026-09-30

## Baglam

Stok sayaclari (stock:{market}:avail:{sku}) Redis'tedir ve TTL'sizdir (ADR-03). Redis
bosalinca (FLUSHALL, kalicilik olmadan yeniden baslatma) sayaclarin tamami gider; stok
servisi bunu bilemediginde her SKU'yu "bu markette yok" sayar, Reserve her seye "stok
yetersiz" der ve durum biri reseed calistirana ya da servisi yeniden baslatana kadar
surer (bekleyen #36, T9.2 canli testinde goruldu).

Tek bir sayacin yoklugu iki seyden biridir: SKU gercekten bu markette satilmiyordur ya da
Redis bosalmistir. Ikisini ayirmak icin sayaclarin yazilip yazilmadigini soyleyen ayri bir
isaret gerekir.

## Karar

Sayaclar Mongo'dan her yazildiginda (acilis, seed, reseed) EN SON bir isaret konur:
stock:seeded (@getir/redis-kit STOCK_SEEDED_MARKER_KEY). Stok servisi bir sayac
bulamadiginda yalnizca o an isarete bakar:

- isaret yerinde: Redis bosalmamistir, SKU gercekten yoktur;
- isaret yok: Redis bosalmistir; sayaclar Mongo'dan yeniden yazilir (yalnizca eksikler,
  SET NX), isaret yeniden konur ve istek bir kez tekrarlanir.

Isaret TTL tasimaz; TTL kuralinin istisna listesine eklenir (.cursor/rules/proje-kurallari.mdc).
Market basina degil tektir ve hash-tag'sizdir: hic sayaci olmayan bir market "bosalmis"
sanilmasin. Rezervasyon Lua script'ine girmez; yalnizca servisin kendisi okur.

## Gerekce

Isaretin anlami sayac kumesinin varligidir; kume TTL'siz oldugu icin isaret de oyle
olmalidir. TTL'li bir isaret sure dolunca "Redis bosaldi" sanilip gereksiz bir tam taramaya
yol acardi. Alternatifler elendi: isaretsiz, her bulunamayan sayacta Mongo'ya bakmak
(gercekten satilmayan her SKU her istekte Mongo'ya gider); periyodik denetim (aradaki
istekler yanlis cevap alir); market basina isaret (sayaci olmayan market her istekte
yeniden kurulum tetiklerdi).

## Sonuclari

- Olumlu: Redis bosalmasi kendiliginden onarilir; normal istekte ek maliyet yoktur (isarete
  yalnizca bulunamayan sayacta bakilir). Yeniden kurulum tek ucusludur: ayni anda gelen
  istekler ayni kurulumu bekler, bekleme sure sinirlidir (asilirsa SERVICE_UNAVAILABLE).
- Olumsuz: Redis bosalinca aktif rezervasyonlar da gitmistir; sayaclar eldeki adetten
  yazilir. Onay ve stok defteri (T10.2) gelince formul B24'e gore genisler (odenmis ama
  onaylanmamis siparisler dusulur).
- Olumsuz: isaret elle silinirse bir sonraki bulunamayan sayac tam taramayi tetikler;
  yalnizca eksik sayaclar yazildigi icin zararsizdir.

## Ilgili

ADR-03 (sayaclar ve ilk TTL istisnalari), ADR-16 (olay akislari); gorev T10.1 PR 2, bekleyen #36.
