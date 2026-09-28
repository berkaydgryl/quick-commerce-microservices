# ADR-16: Olay akislari TTL yerine uzunlukla sinirlanir

- Durum: Kabul edildi
- Tarih: 2026-09-28

## Baglam

Proje kurali her Redis anahtarina bir omur (TTL) ister; istisnalar yalnizca ADR ile
eklenir ve bugun iki tanedir (ADR-03: stok sayaci ve rezervasyon indeksi). Olay hatti iki
anahtar kullanir: stream:events (T7.3'ten beri outbox ciktisi; roadmap Redis semasinda
"MAXLEN 10000" olarak yaziliydi ama kuralin istisna listesinde yoktu) ve T7.4 ile gelen
stream:events:dead (tuketici grubunun isleyemedigi olaylar, gerekcesiyle).

Bir akisa TTL koymak butun anahtari siler: kayitlarla birlikte tuketici gruplari,
gruplarin okuma konumu ve onaylanmamis (bekleyen) kayitlar da gider. Tuketici o an
okuyor olsa bile NOGROUP alir; islenmeyi bekleyen bir iade komutu sessizce kaybolur. TTL
her yazimda yenilense bile, bir sure olay gelmeyen akis gruplariyla birlikte yok olur.

## Karar

Olay akislari TTL tasimaz; boyutlari her yazimda uzunlukla sinirlanir
(XADD ... MAXLEN ~ N ...):

- stream:events: MAXLEN ~ 10000 (@getir/event-bus EVENTS_STREAM_MAX_LENGTH).
- stream:events:dead: MAXLEN ~ 1000 (EVENTS_DEAD_LETTER_MAX_LENGTH).

Bu iki anahtar TTL kuralinin istisna listesine eklenir (.cursor/rules/proje-kurallari.mdc).
Yeni bir akis ayni kuralla ve bu ADR guncellenerek eklenir.

## Gerekce

Akis icin anlamli sinir yas degil kayit sayisidir ve her yazimda uygulanir; bellek tavani
bellidir (10000 olay birkac MB). "~" yaklasik kirpmadir: Redis dugum boyunda keser, yazim
maliyeti sabit kalir. Alternatifler elendi: TTL (yukaridaki kayip); MINID ile yasa gore
kirpma (yogun anda kayit sayisi sinirsiz buyur, bugun gerek yok); olu olaylari Mongo'da
tutmak (kalici olurdu ama olay hattinin disinda ikinci bir depo ve sahibi olan bir servis
gerektirir; ihtiyac dogarsa ayri ADR).

## Sonuclari

- Olumlu: gruplar, konumlari ve bekleyen kayitlar akisla birlikte yasar; bellek siniri
  kodda sabittir.
- Olumsuz: bir tuketici grubu ~10000 olay geride kalirsa okunmamis kayit kirpilir (Redis
  onu bekleyenler listesinden de siler). Olayin kalici kaydi ureticinin outbox'indadir
  (ADR-04); geride kalma grubun lag degeriyle izlenir.
- Olumsuz: olu olaylar akisi 1000 kaydi asarsa en eskiler duser. Asil alarm her olu olayda
  yazilan ERROR gunlugudur; akis inceleme ve elle yeniden oynatma icindir.
- Kabul edilen borc: olu olaylari otomatik yeniden oynatan bir arac yok; elle yordam
  @getir/event-bus README'sindedir ve entegrasyon testinde sinanir.

## Ilgili

ADR-03 (ilk TTL istisnalari), ADR-04, ADR-07; gorevler T7.3, T7.4.
