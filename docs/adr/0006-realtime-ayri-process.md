# ADR-06: Realtime, gateway'den ayri bir process olarak calisir

- Durum: Kabul edildi
- Tarih: 2026-09-20

## Baglam

Musteri siparis durumunu ve kuryenin haritadaki konumunu canli gormek zorunda; kurye
konumu COURIER_TICK_MS=2000 araligiyla uretiliyor. Bu trafigi Go ile yazilan gateway
(8080) icine gomme secenegi vardi. Ancak WebSocket baglantisi uzun omurludur ve
bellekte durum tasir; REST istegi kisa omurludur ve durumsuzdur. Ikisini ayni process'e
koymak, iki farkli olcekleme ve dagitim profilini tek bir kadere baglar: gateway'in her
yeniden baslatmasi tum canli baglantilari koparir, ve acik baglanti sayisi arttikca
siradan REST istekleri de etkilenir.

## Karar

Realtime kendi process'idir ve 3001 portunda calisir; Socket.io ile Redis adapter
kullanir. Gateway REST ve gRPC trafigini tasir, canli yayin akisi ile ilgilenmez.
Servisler canli bildirimleri realtime'a dogrudan cagri ile degil, olay hatti uzerinden
gecirir; realtime bu olaylari odalara (siparis, kurye, dark store) dagitir. Kimlik
dogrulama ortak JWT ile yapilir, yani el sikisma sirasinda token realtime tarafinda da
dogrulanir.

## Gerekce

Ayri process, WebSocket'i bagimsiz olcekler ve yeniden baslatmalari yalitir. Socket.io
protokolu Go tarafinda birinci sinif desteklenmez; ayirmak dil ve kutuphane secimini
serbest birakir. Redis adapter sayesinde birden fazla realtime kopyasi ayni odalari
paylasabilir, boylece yatay olcekleme kapisi acik kalir. Gateway icinde gomulu
alternatif elendi: kazanilan tek sey bir process azdir, bedeli iki isin birbirini
bozmasidir.

## Sonuclari

- Olumlu: canli baglantilar gateway dagitimlarindan etkilenmez; realtime tek basina
  olceklenir ve cokse bile REST akisi ayakta kalir.
- Olumsuz: calistirilacak bir process daha vardir, token dogrulama iki yerde
  yapilmalidir ve gozlemleme iki yere yayilir.
- Kabul edilen borc: birden fazla kopya calistirildiginda yuk dengeleyicide yapiskan
  oturum (ya da uygun aktarim ayari) gerekir; demo tek kopya ile calisir.

## Ilgili

ADR-07, ADR-12; gorev T1.5.
