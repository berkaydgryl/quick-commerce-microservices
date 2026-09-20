# ADR-04: Servisler arasi olaylar outbox uzerinden yayinlanir

- Durum: Kabul edildi
- Tarih: 2026-09-20

## Baglam

Siparis olustugunda odeme, kurye ve realtime servisleri haberdar olmalidir. Naif yol
ikili yazimdir (dual write): once veritabanina yaz, sonra olay hattina bas. Bu yolun her
iki ucu da bozuktur. Once yazip sonra yayinlarsak, yayin adimi basarisiz oldugunda
siparis vardir ama kimse duymamistir; odeme hic baslamaz. Once yayinlayip sonra
yazarsak, yazim basarisiz oldugunda var olmayan bir siparis duyurulmus olur. Process
tam arada cokerse her iki durum da sessizce olusur ve hicbir hata logu birakmaz.

## Karar

Servisler arasi olaylar outbox uzerinden yayinlanir. Is kaydi (ornegin orders) ve outbox
satiri AYNI Mongo transaction'i icinde yazilir; boylece "siparis var" ile "olay uretildi"
tek bir atomik gercektir. Ayri bir relay dongusu outbox'taki yayinlanmamis satirlari
sirayla okur, EventBus'a basar ve basarida satiri yayinlandi olarak isaretler. Transaction
gerektigi icin Mongo yerelde de tek dugumlu replica set olarak calistirilir; baglanti
dizesi mongodb://localhost:27017/getir?directConnection=true olarak sabittir (tek dugumde
replicaSet parametresi ile directConnection birlikte kullanilamaz).

## Gerekce

Transactional outbox, iki sistemi tek atomik yazima indirger ve kurtarmayi
basitlestirir: relay ne zaman ayaga kalkarsa kaldigi yerden devam eder, ayrica tekrar
denemek guvenlidir. Alternatifler elendi: dagitik transaction (2PC) bu yiginda pratik
degildir ve agirdir; CDC ile oplog dinlemek gercek bir altyapi bagimliligi ve operasyon
yuku getirir; ates-et-unut yayin ise yukaridaki kayip senaryolarini hic cozmez.

## Sonuclari

- Olumlu: en az bir kez teslim garantisi ve olay kaybinin olmamasi; outbox ayni zamanda
  "hangi olay ne zaman uretildi" denetim izidir ve demoda gosterilebilir.
- Olumsuz: tuketiciler idempotent olmak zorundadir, olaylar eventId ile tekillenir.
  Yayin, relay dongusu kadar gecikir. Replica set zorunlulugu ayaga kaldirma adimina bir
  replica set baslatma komutu ekler.
- Kabul edilen borc: outbox temizligi yayinlanmis satirlarin yas esigine gore budanmasi
  ile yapilir; siralama garantisi yalnizca ayni bolumleme anahtari icinde beklenir.

## Ilgili

ADR-05, ADR-07, ADR-08; gorev T1.5.
